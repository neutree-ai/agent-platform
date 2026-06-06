// Package memfs implements a read-only FUSE view of a NAP memory store.
// Memories are flat path-keyed records on the server (e.g. "/notes/foo.md");
// we synthesise the directory tree on the fly from a periodically refreshed
// snapshot, and fetch file content lazily on first read.
package memfs

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/hanwen/go-fuse/v2/fs"
	"github.com/hanwen/go-fuse/v2/fuse"

	"github.com/neutree-ai/agent-platform/memory-fuse/internal/cpclient"
)

// Backend is the subset of cpclient used by the FS — abstracted for tests.
type Backend interface {
	ListMemories(ctx context.Context) ([]cpclient.MemoryLite, error)
	GetMemory(ctx context.Context, path string) (*cpclient.Memory, error)
	PutMemory(ctx context.Context, path, content, ifMatchSHA256 string) (*cpclient.Memory, error)
	DeleteMemory(ctx context.Context, path, ifMatchSHA256 string) error
	MoveMemory(ctx context.Context, fromPath, toPath string, overwrite bool, ifMatchSHA256 string) (*cpclient.Memory, error)
}

// ContentCache is the disk-backed store contents cache used to short-circuit
// repeated reads. Optional — nil means "always fetch from backend".
type ContentCache interface {
	Get(storeID, path, expectedSHA string) ([]byte, bool)
	Put(storeID, path, sha string, content []byte) error
	Drop(storeID, path string) error
}

type Options struct {
	Backend         Backend
	StoreID         string // used as the cache namespace
	Cache           ContentCache
	RefreshInterval time.Duration
	Logger          *slog.Logger
}

// Root is the FUSE root node. It owns the snapshot and refresh loop.
type Root struct {
	fs.Inode
	opt  Options
	log  *slog.Logger
	snap *snapshot
}

// RefreshNow forces an immediate snapshot reload. Used by the gRPC Invalidate
// handler so cp-pushed mutations propagate without waiting for the next tick.
func (r *Root) RefreshNow(ctx context.Context) {
	r.refreshOnce(ctx)
}

// snapshot is a tree of dir/file nodes derived from a flat list of paths.
//
// ephemeral holds directories the user `mkdir`'d that have no memory under them
// yet — the backend is flat path-keyed and has no empty-dir concept, so we
// carry them in memory until a descendant memory lands (then they become "real"
// dirs derived from a path) or the daemon restarts (then they evaporate). This
// is what lets `mkdir -p a/b/c && cp x a/b/c/` work in one session.
type snapshot struct {
	mu        sync.RWMutex
	files     map[string]*cpclient.MemoryLite // absolute path -> meta
	children  map[string]map[string]bool      // dir path -> set of immediate child names
	ephemeral map[string]bool                 // dir path -> exists (user-mkdir'd, no memory yet)
}

func newSnapshot() *snapshot {
	return &snapshot{
		files:     map[string]*cpclient.MemoryLite{},
		children:  map[string]map[string]bool{"/": {}},
		ephemeral: map[string]bool{},
	}
}

func (s *snapshot) load(items []cpclient.MemoryLite) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.files = map[string]*cpclient.MemoryLite{}
	s.children = map[string]map[string]bool{"/": {}}
	for i := range items {
		m := items[i]
		s.files[m.Path] = &m
		// register every ancestor dir + the leaf in its parent
		parts := strings.Split(strings.TrimPrefix(m.Path, "/"), "/")
		dir := "/"
		for i, p := range parts {
			if _, ok := s.children[dir]; !ok {
				s.children[dir] = map[string]bool{}
			}
			s.children[dir][p] = true
			if i == len(parts)-1 {
				break
			}
			if dir == "/" {
				dir = "/" + p
			} else {
				dir = dir + "/" + p
			}
			if _, ok := s.children[dir]; !ok {
				s.children[dir] = map[string]bool{}
			}
		}
	}
	// Fold surviving ephemeral dirs back into the tree. Drop any that a real
	// memory now covers (they graduated to real dirs); re-register the rest so
	// listDir / isDir still see them after this reload replaced children.
	for d := range s.ephemeral {
		if _, real := s.children[d]; real {
			delete(s.ephemeral, d)
			continue
		}
		s.registerDirLocked(d)
	}
}

// registerDirLocked makes `dir` (and its ancestors' child links) visible in the
// children map. Caller holds s.mu.
func (s *snapshot) registerDirLocked(dir string) {
	if dir == "/" {
		return
	}
	if _, ok := s.children[dir]; !ok {
		s.children[dir] = map[string]bool{}
	}
	parts := strings.Split(strings.TrimPrefix(dir, "/"), "/")
	cur := "/"
	for _, p := range parts {
		if _, ok := s.children[cur]; !ok {
			s.children[cur] = map[string]bool{}
		}
		s.children[cur][p] = true
		if cur == "/" {
			cur = "/" + p
		} else {
			cur = cur + "/" + p
		}
	}
}

// addEphemeralDir records a user-created empty directory and makes it visible.
func (s *snapshot) addEphemeralDir(dir string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ephemeral[dir] = true
	s.registerDirLocked(dir)
}

// removeEphemeralDir drops an empty ephemeral dir (rmdir). Returns false if the
// dir isn't ephemeral (real dirs / non-empty can't be removed this way).
func (s *snapshot) removeEphemeralDir(dir string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.ephemeral[dir] {
		return false
	}
	delete(s.ephemeral, dir)
	delete(s.children, dir)
	// Unlink from parent's child set.
	idx := strings.LastIndex(dir, "/")
	parent := "/"
	if idx > 0 {
		parent = dir[:idx]
	}
	name := dir[idx+1:]
	if c, ok := s.children[parent]; ok {
		delete(c, name)
	}
	return true
}

func (s *snapshot) listDir(dir string) ([]string, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	c, ok := s.children[dir]
	if !ok {
		return nil, false
	}
	out := make([]string, 0, len(c))
	for n := range c {
		out = append(out, n)
	}
	return out, true
}

func (s *snapshot) file(path string) (*cpclient.MemoryLite, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	m, ok := s.files[path]
	return m, ok
}

func (s *snapshot) isDir(path string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	_, ok := s.children[path]
	return ok
}

// NewRoot returns the FS root and starts a background refresh loop.
func NewRoot(ctx context.Context, opt Options) *Root {
	if opt.Logger == nil {
		opt.Logger = slog.Default()
	}
	if opt.RefreshInterval == 0 {
		// Fallback only — mountmgr always passes an explicit value. Kept in
		// sync with mountmgr's default (the missed-Invalidate-push backstop).
		opt.RefreshInterval = 600 * time.Second
	}
	r := &Root{opt: opt, log: opt.Logger, snap: newSnapshot()}
	r.refreshOnce(ctx)
	go r.refreshLoop(ctx)
	return r
}

func (r *Root) refreshOnce(ctx context.Context) {
	items, err := r.opt.Backend.ListMemories(ctx)
	if err != nil {
		r.log.Warn("memory list refresh failed", "error", err)
		return
	}
	r.snap.load(items)
	r.log.Debug("memory snapshot refreshed", "count", len(items))
}

func (r *Root) refreshLoop(ctx context.Context) {
	t := time.NewTicker(r.opt.RefreshInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			r.refreshOnce(ctx)
		}
	}
}

// path-of-node helper: walks parents to materialise the absolute path.
func nodePath(n *fs.Inode) string {
	parts := []string{}
	for {
		name, parent := n.Parent()
		if parent == nil {
			break
		}
		parts = append([]string{name}, parts...)
		n = parent
	}
	return "/" + strings.Join(parts, "/")
}

// ── interfaces on Root ──────────────────────────────────────────────────────

var _ fs.NodeOnAdder = (*Root)(nil)

// OnAdd is called once after mount. We don't pre-populate the tree; lookups
// hit Lookup which consults the snapshot on demand.
func (r *Root) OnAdd(_ context.Context) {}

var _ fs.NodeLookuper = (*Root)(nil)
var _ fs.NodeReaddirer = (*Root)(nil)
var _ fs.NodeCreater = (*Root)(nil)
var _ fs.NodeUnlinker = (*Root)(nil)
var _ fs.NodeMkdirer = (*Root)(nil)
var _ fs.NodeRmdirer = (*Root)(nil)
var _ fs.NodeRenamer = (*Root)(nil)
var _ fs.NodeStatfser = (*Root)(nil)

func (r *Root) Lookup(ctx context.Context, name string, out *fuse.EntryOut) (*fs.Inode, syscall.Errno) {
	return lookupChild(ctx, &r.Inode, "/", name, r, out)
}

func (r *Root) Readdir(ctx context.Context) (fs.DirStream, syscall.Errno) {
	return readdirAt(r, "/")
}

func (r *Root) Create(ctx context.Context, name string, _ uint32, _ uint32, out *fuse.EntryOut) (*fs.Inode, fs.FileHandle, uint32, syscall.Errno) {
	return createChild(ctx, &r.Inode, "/", name, r, out)
}

func (r *Root) Unlink(ctx context.Context, name string) syscall.Errno {
	return unlinkChild(ctx, "/", name, r)
}

func (r *Root) Mkdir(ctx context.Context, name string, _ uint32, out *fuse.EntryOut) (*fs.Inode, syscall.Errno) {
	return mkdirChild(&r.Inode, "/", name, r, out)
}

func (r *Root) Rmdir(_ context.Context, name string) syscall.Errno {
	return rmdirChild("/", name, r)
}

func (r *Root) Rename(ctx context.Context, name string, newParent fs.InodeEmbedder, newName string, flags uint32) syscall.Errno {
	return renameChild(ctx, "/", name, newParent, newName, flags, r)
}

func (r *Root) Statfs(_ context.Context, out *fuse.StatfsOut) syscall.Errno {
	fillStatfs(out)
	return 0
}

// ── dir & file node types ───────────────────────────────────────────────────

type dirNode struct {
	fs.Inode
	root *Root
}

var _ fs.NodeLookuper = (*dirNode)(nil)
var _ fs.NodeReaddirer = (*dirNode)(nil)
var _ fs.NodeCreater = (*dirNode)(nil)
var _ fs.NodeUnlinker = (*dirNode)(nil)
var _ fs.NodeMkdirer = (*dirNode)(nil)
var _ fs.NodeRmdirer = (*dirNode)(nil)
var _ fs.NodeRenamer = (*dirNode)(nil)

func (d *dirNode) Lookup(ctx context.Context, name string, out *fuse.EntryOut) (*fs.Inode, syscall.Errno) {
	return lookupChild(ctx, &d.Inode, nodePath(&d.Inode), name, d.root, out)
}

func (d *dirNode) Readdir(ctx context.Context) (fs.DirStream, syscall.Errno) {
	return readdirAt(d.root, nodePath(&d.Inode))
}

func (d *dirNode) Create(ctx context.Context, name string, _ uint32, _ uint32, out *fuse.EntryOut) (*fs.Inode, fs.FileHandle, uint32, syscall.Errno) {
	return createChild(ctx, &d.Inode, nodePath(&d.Inode), name, d.root, out)
}

func (d *dirNode) Unlink(ctx context.Context, name string) syscall.Errno {
	return unlinkChild(ctx, nodePath(&d.Inode), name, d.root)
}

func (d *dirNode) Mkdir(ctx context.Context, name string, _ uint32, out *fuse.EntryOut) (*fs.Inode, syscall.Errno) {
	return mkdirChild(&d.Inode, nodePath(&d.Inode), name, d.root, out)
}

func (d *dirNode) Rmdir(_ context.Context, name string) syscall.Errno {
	return rmdirChild(nodePath(&d.Inode), name, d.root)
}

func (d *dirNode) Rename(ctx context.Context, name string, newParent fs.InodeEmbedder, newName string, flags uint32) syscall.Errno {
	return renameChild(ctx, nodePath(&d.Inode), name, newParent, newName, flags, d.root)
}

type fileNode struct {
	fs.Inode
	root *Root
	// Per-file write/read buffer with sha-keyed cache. baseSHA is the
	// server's sha of `buf` when last fetched (or "" for a brand-new file
	// not yet pushed). dirty=true means buf differs from server and needs
	// flushing. mu serialises load/write/flush against concurrent reads.
	mu      sync.Mutex
	loaded  bool
	dirty   bool
	baseSHA string
	buf     []byte
}

var _ fs.NodeOpener = (*fileNode)(nil)
var _ fs.NodeReader = (*fileNode)(nil)
var _ fs.NodeGetattrer = (*fileNode)(nil)
var _ fs.NodeWriter = (*fileNode)(nil)
var _ fs.NodeFlusher = (*fileNode)(nil)
var _ fs.NodeFsyncer = (*fileNode)(nil)
var _ fs.NodeSetattrer = (*fileNode)(nil)

func (f *fileNode) Getattr(_ context.Context, _ fs.FileHandle, out *fuse.AttrOut) syscall.Errno {
	out.Mode = fuse.S_IFREG | 0o644
	f.mu.Lock()
	if f.loaded {
		out.Size = uint64(len(f.buf))
		f.mu.Unlock()
		return 0
	}
	f.mu.Unlock()
	if m, ok := f.root.snap.file(nodePath(&f.Inode)); ok {
		out.Size = uint64(m.SizeBytes)
		return 0
	}
	// Newly created file before first flush — empty.
	out.Size = 0
	return 0
}

func (f *fileNode) Open(_ context.Context, _ uint32) (fs.FileHandle, uint32, syscall.Errno) {
	// Direct-IO so the kernel passes through reads/writes without caching;
	// keeps content fresh as the server-side sha changes.
	return nil, fuse.FOPEN_DIRECT_IO, 0
}

func (f *fileNode) Read(ctx context.Context, _ fs.FileHandle, dest []byte, off int64) (fuse.ReadResult, syscall.Errno) {
	if errno := f.ensureLoaded(ctx); errno != 0 {
		return nil, errno
	}
	f.mu.Lock()
	body := f.buf
	end := off + int64(len(dest))
	if end > int64(len(body)) {
		end = int64(len(body))
	}
	if off >= end {
		f.mu.Unlock()
		return fuse.ReadResultData(nil), 0
	}
	out := append([]byte(nil), body[off:end]...)
	f.mu.Unlock()
	return fuse.ReadResultData(out), 0
}

func (f *fileNode) Write(ctx context.Context, _ fs.FileHandle, data []byte, off int64) (uint32, syscall.Errno) {
	if errno := f.ensureLoaded(ctx); errno != 0 {
		return 0, errno
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	end := int(off) + len(data)
	if end > len(f.buf) {
		grown := make([]byte, end)
		copy(grown, f.buf)
		f.buf = grown
	}
	copy(f.buf[off:], data)
	f.dirty = true
	return uint32(len(data)), 0
}

func (f *fileNode) Setattr(ctx context.Context, _ fs.FileHandle, in *fuse.SetAttrIn, out *fuse.AttrOut) syscall.Errno {
	if size, ok := in.GetSize(); ok {
		if errno := f.ensureLoaded(ctx); errno != 0 {
			return errno
		}
		f.mu.Lock()
		if uint64(len(f.buf)) > size {
			f.buf = f.buf[:size]
		} else if uint64(len(f.buf)) < size {
			grown := make([]byte, size)
			copy(grown, f.buf)
			f.buf = grown
		}
		f.dirty = true
		out.Size = size
		f.mu.Unlock()
	}
	out.Mode = fuse.S_IFREG | 0o644
	return 0
}

// Flush is invoked on every close(2) of an open fd. We treat it as
// commit-on-close: if dirty, PUT to the server with sha precondition,
// then refresh the snapshot so listings reflect the new state.
func (f *fileNode) Flush(ctx context.Context, _ fs.FileHandle) syscall.Errno {
	return f.commit(ctx)
}

// Fsync persists the buffer to the server on explicit fsync(2)/fdatasync(2).
// Without it the only durability point is close(2)→Flush, so an application
// that fsyncs and assumes its bytes are durable (before close) would be wrong.
// Same commit path as Flush; a clean (non-dirty) buffer is a no-op.
func (f *fileNode) Fsync(ctx context.Context, _ fs.FileHandle, _ uint32) syscall.Errno {
	return f.commit(ctx)
}

func (f *fileNode) commit(ctx context.Context) syscall.Errno {
	f.mu.Lock()
	if !f.dirty {
		f.mu.Unlock()
		return 0
	}
	body := append([]byte(nil), f.buf...)
	base := f.baseSHA
	f.mu.Unlock()

	path := nodePath(&f.Inode)
	// Hard validation: agents (or `echo > foo.md` typo) writing content that
	// can't be picked up by Reflect / consolidation get rejected at the FUSE
	// layer instead of polluting the store. EINVAL surfaces to the caller as
	// "invalid argument" — interactive shells show it directly, agents see
	// it as a tool error they can recover from.
	if err := validateMemoryContent(path, body); err != nil {
		f.root.log.Warn("memory frontmatter validation rejected", "path", path, "error", err)
		f.mu.Lock()
		f.dirty = false
		f.loaded = false
		f.mu.Unlock()
		return syscall.EINVAL
	}
	m, err := f.root.opt.Backend.PutMemory(ctx, path, string(body), base)
	if err != nil {
		var pre *cpclient.ErrPrecondition
		if errors.As(err, &pre) {
			f.root.log.Warn("memory flush sha mismatch", "path", path, "expected", base, "current", pre.CurrentSHA256)
			// Drop our local view; next read will fetch the new server copy.
			f.mu.Lock()
			f.loaded = false
			f.dirty = false
			f.mu.Unlock()
			f.root.refreshOnce(ctx)
			return syscall.EIO
		}
		f.root.log.Error("memory flush failed", "path", path, "error", err)
		return syscall.EIO
	}
	f.mu.Lock()
	f.baseSHA = m.ContentSHA256
	f.dirty = false
	f.mu.Unlock()
	if c := f.root.opt.Cache; c != nil && m.ContentSHA256 != "" {
		// Same content we just sent — keep the cache warm so a re-read in
		// the same daemon process (or after restart, since this is disk-
		// backed) skips the round trip. cp will broadcast Invalidate to
		// every other ws that has this store attached, including this one;
		// the broadcast clears the store dir, but the just-written sha
		// matches the snapshot's, so the next read here just re-populates.
		if err := c.Put(f.root.opt.StoreID, path, m.ContentSHA256, []byte(body)); err != nil {
			f.root.log.Warn("cache put on flush failed", "path", path, "error", err)
		}
	}
	f.root.refreshOnce(ctx)
	return 0
}

// ensureLoaded populates buf+baseSHA on first access. Three sources, in
// order of preference: an existing buf (same fileNode lifecycle); the
// disk-backed cache (validated against the snapshot's sha); the cp HTTP
// backend (fills both buf and the cache). For files without a server-side
// row yet (freshly Create'd) buf stays empty and baseSHA stays "" so the
// next PUT asserts must-not-exist.
func (f *fileNode) ensureLoaded(ctx context.Context) syscall.Errno {
	f.mu.Lock()
	if f.loaded {
		f.mu.Unlock()
		return 0
	}
	f.mu.Unlock()
	path := nodePath(&f.Inode)

	// Try the cache, but only when we know what sha the snapshot expects —
	// without that we can't tell if the disk copy is stale.
	if c := f.root.opt.Cache; c != nil {
		if m, ok := f.root.snap.file(path); ok && m.ContentSHA256 != "" {
			if content, hit := c.Get(f.root.opt.StoreID, path, m.ContentSHA256); hit {
				f.mu.Lock()
				f.loaded = true
				f.buf = content
				f.baseSHA = m.ContentSHA256
				f.mu.Unlock()
				return 0
			}
		}
	}

	full, err := f.root.opt.Backend.GetMemory(ctx, path)
	if err != nil {
		if errors.Is(err, cpclient.ErrNotFound) {
			f.mu.Lock()
			f.loaded = true
			f.buf = nil
			f.baseSHA = ""
			f.mu.Unlock()
			return 0
		}
		f.root.log.Warn("memory fetch failed", "path", path, "error", err)
		return syscall.EIO
	}
	content := []byte(full.Content)
	f.mu.Lock()
	f.loaded = true
	f.buf = content
	f.baseSHA = full.ContentSHA256
	f.mu.Unlock()
	if c := f.root.opt.Cache; c != nil && full.ContentSHA256 != "" {
		if err := c.Put(f.root.opt.StoreID, path, full.ContentSHA256, content); err != nil {
			f.root.log.Warn("cache put failed", "path", path, "error", err)
		}
	}
	return 0
}

// ── lookup / readdir helpers ────────────────────────────────────────────────

func lookupChild(_ context.Context, parent *fs.Inode, parentPath, name string, root *Root, out *fuse.EntryOut) (*fs.Inode, syscall.Errno) {
	full := joinPath(parentPath, name)
	if m, ok := root.snap.file(full); ok {
		ch := parent.NewPersistentInode(context.Background(), &fileNode{root: root}, fs.StableAttr{Mode: fuse.S_IFREG})
		out.Mode = fuse.S_IFREG | 0o644
		out.Size = uint64(m.SizeBytes)
		return ch, 0
	}
	if root.snap.isDir(full) {
		ch := parent.NewPersistentInode(context.Background(), &dirNode{root: root}, fs.StableAttr{Mode: fuse.S_IFDIR})
		out.Mode = fuse.S_IFDIR | 0o755
		return ch, 0
	}
	return nil, syscall.ENOENT
}

func createChild(_ context.Context, parent *fs.Inode, parentPath, name string, root *Root, out *fuse.EntryOut) (*fs.Inode, fs.FileHandle, uint32, syscall.Errno) {
	full := joinPath(parentPath, name)
	if root.snap.isDir(full) {
		return nil, nil, 0, syscall.EISDIR
	}
	child := &fileNode{root: root, loaded: true, dirty: false, baseSHA: ""}
	inode := parent.NewPersistentInode(context.Background(), child, fs.StableAttr{Mode: fuse.S_IFREG})
	out.Mode = fuse.S_IFREG | 0o644
	out.Size = 0
	return inode, nil, fuse.FOPEN_DIRECT_IO, 0
}

func unlinkChild(ctx context.Context, parentPath, name string, root *Root) syscall.Errno {
	full := joinPath(parentPath, name)
	meta, ok := root.snap.file(full)
	if !ok {
		return syscall.ENOENT
	}
	if err := root.opt.Backend.DeleteMemory(ctx, full, meta.ContentSHA256); err != nil {
		var pre *cpclient.ErrPrecondition
		if errors.As(err, &pre) {
			root.log.Warn("memory delete sha mismatch", "path", full, "expected", meta.ContentSHA256, "current", pre.CurrentSHA256)
			root.refreshOnce(ctx)
			return syscall.EIO
		}
		if errors.Is(err, cpclient.ErrNotFound) {
			root.refreshOnce(ctx)
			return syscall.ENOENT
		}
		root.log.Error("memory delete failed", "path", full, "error", err)
		return syscall.EIO
	}
	if c := root.opt.Cache; c != nil {
		if err := c.Drop(root.opt.StoreID, full); err != nil {
			root.log.Warn("cache drop failed", "path", full, "error", err)
		}
	}
	root.refreshOnce(ctx)
	return 0
}

// renameNoReplace mirrors the renameat2 RENAME_NOREPLACE flag (0x1). go-fuse's
// fs package exports RENAME_EXCHANGE but not this one.
const renameNoReplace = 0x1

func mkdirChild(parent *fs.Inode, parentPath, name string, root *Root, out *fuse.EntryOut) (*fs.Inode, syscall.Errno) {
	full := joinPath(parentPath, name)
	if _, ok := root.snap.file(full); ok {
		return nil, syscall.EEXIST
	}
	if root.snap.isDir(full) {
		return nil, syscall.EEXIST
	}
	// Backend has no empty-dir concept; track it in memory until a memory lands
	// under it (or the daemon restarts).
	root.snap.addEphemeralDir(full)
	ch := parent.NewPersistentInode(context.Background(), &dirNode{root: root}, fs.StableAttr{Mode: fuse.S_IFDIR})
	out.Mode = fuse.S_IFDIR | 0o755
	return ch, 0
}

func rmdirChild(parentPath, name string, root *Root) syscall.Errno {
	full := joinPath(parentPath, name)
	if !root.snap.isDir(full) {
		return syscall.ENOENT
	}
	// Only empty ephemeral dirs can be removed. A dir backed by memories is
	// non-empty (and isn't a real filesystem object anyway) — refuse so we
	// don't pretend to delete server data via rmdir.
	if names, ok := root.snap.listDir(full); ok && len(names) > 0 {
		return syscall.ENOTEMPTY
	}
	if !root.snap.removeEphemeralDir(full) {
		// Empty but not ephemeral — shouldn't normally happen; be conservative.
		return syscall.ENOTEMPTY
	}
	return 0
}

// renameChild backs rename(2). Only files (server-backed memories) move; the
// backend is flat so a directory rename would be a prefix bulk-move — we return
// EXDEV for those to let userspace fall back to copy+unlink. The library
// (rawBridge.Rename) performs the in-kernel inode move on a 0 return.
func renameChild(ctx context.Context, oldParentPath, oldName string, newParent fs.InodeEmbedder, newName string, flags uint32, root *Root) syscall.Errno {
	if flags&fs.RENAME_EXCHANGE != 0 {
		return syscall.ENOSYS // atomic exchange unsupported
	}
	from := joinPath(oldParentPath, oldName)
	to := joinPath(nodePath(newParent.EmbeddedInode()), newName)
	if from == to {
		return 0
	}
	if root.snap.isDir(from) {
		return syscall.EXDEV // nudge userspace into recursive copy+unlink
	}
	if _, ok := root.snap.file(from); !ok {
		// Nothing server-backed at `from` — e.g. a freshly Create'd file that was
		// never flushed. We can't move what cp doesn't have.
		return syscall.ENOENT
	}
	overwrite := flags&renameNoReplace == 0
	if _, err := root.opt.Backend.MoveMemory(ctx, from, to, overwrite, ""); err != nil {
		switch {
		case errors.Is(err, cpclient.ErrConflict):
			return syscall.EEXIST
		case errors.Is(err, cpclient.ErrNotFound):
			root.refreshOnce(ctx)
			return syscall.ENOENT
		default:
			root.log.Error("memory rename failed", "from", from, "to", to, "error", err)
			return syscall.EIO
		}
	}
	if c := root.opt.Cache; c != nil {
		if err := c.Drop(root.opt.StoreID, from); err != nil {
			root.log.Warn("cache drop failed", "path", from, "error", err)
		}
		if err := c.Drop(root.opt.StoreID, to); err != nil {
			root.log.Warn("cache drop failed", "path", to, "error", err)
		}
	}
	root.refreshOnce(ctx)
	return 0
}

// fillStatfs reports a large, mostly-free volume so tools that probe free space
// (df, editors checking room before save) don't choke on an all-zero statfs.
// The numbers are synthetic — the backend has no real block accounting.
func fillStatfs(out *fuse.StatfsOut) {
	const blockSize = 4096
	out.Bsize = blockSize
	out.Frsize = blockSize
	out.Blocks = 1 << 32 // ~16 TiB at 4 KiB blocks
	out.Bfree = 1 << 31
	out.Bavail = 1 << 31
	out.Files = 1 << 20
	out.Ffree = 1 << 20
	out.NameLen = 255
}

func readdirAt(root *Root, dir string) (fs.DirStream, syscall.Errno) {
	names, ok := root.snap.listDir(dir)
	if !ok {
		return nil, syscall.ENOENT
	}
	entries := make([]fuse.DirEntry, 0, len(names))
	for _, n := range names {
		full := joinPath(dir, n)
		mode := uint32(fuse.S_IFREG)
		if root.snap.isDir(full) {
			mode = fuse.S_IFDIR
		}
		entries = append(entries, fuse.DirEntry{Name: n, Mode: mode})
	}
	return fs.NewListDirStream(entries), 0
}

func joinPath(parent, name string) string {
	if parent == "/" {
		return "/" + name
	}
	return parent + "/" + name
}
