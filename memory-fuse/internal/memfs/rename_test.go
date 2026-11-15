package memfs

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"log/slog"
	"sort"
	"sync"
	"syscall"
	"testing"

	"github.com/hanwen/go-fuse/v2/fs"
	"github.com/hanwen/go-fuse/v2/fuse"

	"github.com/neutree-ai/agent-platform/memory-fuse/internal/cpclient"
)

// fakeBackend is an in-memory path -> content store with sha preconditions.
type fakeBackend struct {
	mu    sync.Mutex
	files map[string]string
	puts  []string
	moves int
}

func newFakeBackend(files map[string]string) *fakeBackend {
	return &fakeBackend{files: files}
}

func sha(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

func (b *fakeBackend) ListMemories(context.Context) ([]cpclient.MemoryLite, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	out := make([]cpclient.MemoryLite, 0, len(b.files))
	for p, c := range b.files {
		out = append(out, cpclient.MemoryLite{Path: p, ContentSHA256: sha(c), SizeBytes: int64(len(c))})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out, nil
}

func (b *fakeBackend) GetMemory(_ context.Context, path string) (*cpclient.Memory, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	c, ok := b.files[path]
	if !ok {
		return nil, cpclient.ErrNotFound
	}
	return mem(path, c), nil
}

func (b *fakeBackend) PutMemory(_ context.Context, path, content, ifMatch string) (*cpclient.Memory, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	cur, exists := b.files[path]
	if (ifMatch == "" && exists) || (ifMatch != "" && (!exists || sha(cur) != ifMatch)) {
		return nil, &cpclient.ErrPrecondition{CurrentSHA256: sha(cur)}
	}
	b.files[path] = content
	b.puts = append(b.puts, path)
	return mem(path, content), nil
}

func (b *fakeBackend) DeleteMemory(_ context.Context, path, _ string) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	delete(b.files, path)
	return nil
}

func (b *fakeBackend) MoveMemory(_ context.Context, from, to string, overwrite bool, _ string) (*cpclient.Memory, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	c, ok := b.files[from]
	if !ok {
		return nil, cpclient.ErrNotFound
	}
	if _, exists := b.files[to]; exists && !overwrite {
		return nil, cpclient.ErrConflict
	}
	delete(b.files, from)
	b.files[to] = c
	b.moves++
	return mem(to, c), nil
}

func mem(path, content string) *cpclient.Memory {
	return &cpclient.Memory{
		MemoryLite: cpclient.MemoryLite{Path: path, ContentSHA256: sha(content), SizeBytes: int64(len(content))},
		Content:    content,
	}
}

const validMemory = "---\nname: a\nmetadata:\n  type: project\n---\n\nbody\n"

func newTestRoot(t *testing.T, b *fakeBackend) *Root {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	r := NewRoot(ctx, Options{Backend: b, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))})
	fs.NewNodeFS(r, &fs.Options{}) // wires the root inode so children get paths
	return r
}

// writeFile mimics open(O_CREAT)+write+close on a new file in the root.
func writeFile(t *testing.T, r *Root, name, content string) (*fileNode, syscall.Errno) {
	t.Helper()
	ctx := context.Background()
	inode, _, _, errno := r.Create(ctx, name, 0, 0o644, &fuse.EntryOut{})
	if errno != 0 {
		t.Fatalf("create %s: %v", name, errno)
	}
	r.AddChild(name, inode, true)
	f := inode.Operations().(*fileNode)
	if _, errno := f.Write(ctx, nil, []byte(content), 0); errno != 0 {
		t.Fatalf("write %s: %v", name, errno)
	}
	return f, f.Flush(ctx, nil)
}

func TestAtomicSaveOverIndex(t *testing.T) {
	b := newFakeBackend(map[string]string{"/MEMORY.md": "# old index\n"})
	r := newTestRoot(t, b)

	_, errno := writeFile(t, r, "MEMORY.md.tmp.1.abc", "# new index\n")
	if errno != syscall.EINVAL {
		t.Fatalf("close of index temp file = %v, want EINVAL", errno)
	}
	if errno := r.Rename(context.Background(), "MEMORY.md.tmp.1.abc", r, "MEMORY.md", 0); errno != 0 {
		t.Fatalf("rename over index = %v, want success", errno)
	}

	if got := b.files["/MEMORY.md"]; got != "# new index\n" {
		t.Fatalf("index content = %q", got)
	}
	if _, ok := b.files["/MEMORY.md.tmp.1.abc"]; ok {
		t.Fatal("temp file was pushed to the store")
	}
	if len(b.puts) != 1 || b.puts[0] != "/MEMORY.md" {
		t.Fatalf("puts = %v, want only /MEMORY.md", b.puts)
	}
}

func TestStagedContentIsValidatedAtDestination(t *testing.T) {
	b := newFakeBackend(map[string]string{})
	r := newTestRoot(t, b)

	writeFile(t, r, "tmp1", "no frontmatter\n")
	if errno := r.Rename(context.Background(), "tmp1", r, "notes.md", 0); errno != syscall.EINVAL {
		t.Fatalf("rename invalid content to a memory = %v, want EINVAL", errno)
	}
	if len(b.files) != 0 {
		t.Fatalf("store = %v, want empty", b.files)
	}
}

func TestStagedRenameRespectsNoReplace(t *testing.T) {
	b := newFakeBackend(map[string]string{"/MEMORY.md": "# old\n"})
	r := newTestRoot(t, b)

	writeFile(t, r, "tmp1", "# new\n")
	if errno := r.Rename(context.Background(), "tmp1", r, "MEMORY.md", renameNoReplace); errno != syscall.EEXIST {
		t.Fatalf("no-replace rename = %v, want EEXIST", errno)
	}
	if got := b.files["/MEMORY.md"]; got != "# old\n" {
		t.Fatalf("index content = %q", got)
	}
}

func TestValidTempFileStillMoves(t *testing.T) {
	b := newFakeBackend(map[string]string{"/a.md": validMemory})
	r := newTestRoot(t, b)

	if _, errno := writeFile(t, r, "a.md.tmp.1.abc", validMemory+"more\n"); errno != 0 {
		t.Fatalf("close of valid temp file = %v", errno)
	}
	if errno := r.Rename(context.Background(), "a.md.tmp.1.abc", r, "a.md", 0); errno != 0 {
		t.Fatalf("rename = %v", errno)
	}
	if b.moves != 1 || b.files["/a.md"] != validMemory+"more\n" {
		t.Fatalf("moves=%d content=%q", b.moves, b.files["/a.md"])
	}
}

func TestRenameOfUnwrittenFileIsENOENT(t *testing.T) {
	b := newFakeBackend(map[string]string{})
	r := newTestRoot(t, b)

	inode, _, _, _ := r.Create(context.Background(), "x", 0, 0o644, &fuse.EntryOut{})
	r.AddChild("x", inode, true)
	if errno := r.Rename(context.Background(), "x", r, "y.md", 0); errno != syscall.ENOENT {
		t.Fatalf("rename of never-written file = %v, want ENOENT", errno)
	}
}
