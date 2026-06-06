// Package mountmgr owns the per-store FUSE mounts inside a memory-fuse pod.
// One Manager instance per workspace; it holds a map[storeID] -> live mount.
//
// Each mount is a separate FUSE filesystem at /mnt/memory/<store_id>/, backed
// by a per-store cpclient.Client and a memfs.Root with its own refresh loop.
// Mount/Unmount are idempotent and safe to call repeatedly.
package mountmgr

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/hanwen/go-fuse/v2/fs"
	"github.com/hanwen/go-fuse/v2/fuse"

	"github.com/neutree-ai/agent-platform/memory-fuse/internal/cpclient"
	"github.com/neutree-ai/agent-platform/memory-fuse/internal/memfs"
)

// ContentCache is the disk-backed cache shared across all mounts. Optional;
// nil means "no cache" (every read falls through to the backend).
type ContentCache interface {
	memfs.ContentCache
	Invalidate(storeID string) error
}

type Options struct {
	CPURL           string        // cp base URL, e.g. http://nap-cp.default.svc:3000
	WorkspaceID     string        // baked into cp URLs for /_cp/workspaces/<id>/...
	MountRoot       string        // typically /mnt/memory
	Cache           ContentCache  // disk-backed content cache (optional)
	RefreshInterval time.Duration // memfs snapshot poll interval
	Logger          *slog.Logger
}

// Manager is goroutine-safe. cancel funcs are stored alongside servers so
// Unmount can stop the per-mount refresh loop.
type Manager struct {
	opt    Options
	log    *slog.Logger
	mu     sync.Mutex
	mounts map[string]*mount
}

type mount struct {
	storeID    string
	mountpoint string
	readOnly   bool
	server     *fuse.Server
	cancel     context.CancelFunc
	root       *memfs.Root
}

func New(opt Options) *Manager {
	if opt.Logger == nil {
		opt.Logger = slog.Default()
	}
	if opt.RefreshInterval == 0 {
		// Snapshot polling is only the fallback for a missed cp Invalidate
		// push. Mount-time and post-write freshness are handled by explicit
		// refreshOnce calls (memfs.NewRoot + the write/delete paths), not this
		// ticker — so keep the interval long. It just bounds how stale a mount
		// can get in the rare case a push was dropped, and a short interval
		// only floods cp with /memories polls across the whole fleet.
		opt.RefreshInterval = 600 * time.Second
	}
	if opt.MountRoot == "" {
		opt.MountRoot = "/mnt/memory"
	}
	return &Manager{opt: opt, log: opt.Logger, mounts: map[string]*mount{}}
}

// Mount adds (or refreshes) a mount for the given store at <root>/<store_id>/.
// Re-issuing for an existing storeID with a different read_only flag tears
// down the old mount and re-creates it; same flag is a no-op.
func (m *Manager) Mount(ctx context.Context, storeID string, readOnly bool) (string, error) {
	if storeID == "" {
		return "", errors.New("store_id is required")
	}
	mountpoint := filepath.Join(m.opt.MountRoot, storeID)

	m.mu.Lock()
	if existing, ok := m.mounts[storeID]; ok {
		if existing.readOnly == readOnly {
			m.mu.Unlock()
			return existing.mountpoint, nil
		}
		// flag changed — tear down then rebuild
		m.mu.Unlock()
		if err := m.Unmount(storeID); err != nil {
			m.log.Warn("remount: prior unmount failed", "store_id", storeID, "error", err)
		}
		m.mu.Lock()
	}
	m.mu.Unlock()

	if err := os.MkdirAll(mountpoint, 0o755); err != nil {
		return "", fmt.Errorf("mkdir %s: %w", mountpoint, err)
	}

	client := cpclient.New(cpclient.Options{
		BaseURL:     m.opt.CPURL,
		WorkspaceID: m.opt.WorkspaceID,
		StoreID:     storeID,
	})
	mctx, cancel := context.WithCancel(context.Background())
	_ = ctx // boot ctx not retained — mount runs until Unmount
	var cacheArg memfs.ContentCache
	if m.opt.Cache != nil {
		cacheArg = m.opt.Cache
	}
	root := memfs.NewRoot(mctx, memfs.Options{
		Backend:         client,
		StoreID:         storeID,
		Cache:           cacheArg,
		RefreshInterval: m.opt.RefreshInterval,
		Logger:          m.log.With("store_id", storeID),
	})

	server, err := fs.Mount(mountpoint, root, &fs.Options{
		MountOptions: fuse.MountOptions{
			FsName: "memory-fuse",
			Name:   "memoryfs-" + storeID,
			// The agent container runs as a non-root user (e.g. `node`),
			// while the daemon mounts as root. Without AllowOther the FUSE
			// layer rejects the agent's syscalls with EACCES. The daemon
			// container is privileged (required for Bidirectional mount
			// propagation anyway), so user_allow_other is implicitly fine.
			AllowOther: true,
		},
	})
	if err != nil {
		cancel()
		return "", fmt.Errorf("fuse mount %s: %w", mountpoint, err)
	}

	m.mu.Lock()
	m.mounts[storeID] = &mount{
		storeID:    storeID,
		mountpoint: mountpoint,
		readOnly:   readOnly,
		server:     server,
		cancel:     cancel,
		root:       root,
	}
	m.mu.Unlock()

	m.log.Info("mounted", "store_id", storeID, "mountpoint", mountpoint, "read_only", readOnly)
	return mountpoint, nil
}

// Invalidate clears the disk cache for a store and forces an immediate
// snapshot refresh on its mount. Called from the gRPC Invalidate handler
// when cp broadcasts a write/delete. Safe to call for an unmounted store
// (we still drop disk cache).
func (m *Manager) Invalidate(storeID string) error {
	if m.opt.Cache != nil {
		if err := m.opt.Cache.Invalidate(storeID); err != nil {
			m.log.Warn("cache invalidate failed", "store_id", storeID, "error", err)
		}
	}
	m.mu.Lock()
	mt, ok := m.mounts[storeID]
	m.mu.Unlock()
	if !ok {
		return nil
	}
	mt.root.RefreshNow(context.Background())
	return nil
}

// Unmount tears down the mount for the given storeID. Returns nil if no such
// mount existed (idempotent).
func (m *Manager) Unmount(storeID string) error {
	m.mu.Lock()
	mt, ok := m.mounts[storeID]
	if ok {
		delete(m.mounts, storeID)
	}
	m.mu.Unlock()
	if !ok {
		return nil
	}
	mt.cancel()
	if err := mt.server.Unmount(); err != nil {
		m.log.Warn("unmount failed", "store_id", storeID, "mountpoint", mt.mountpoint, "error", err)
		return err
	}
	// Symmetric cleanup with the MkdirAll in Mount: drop the now-empty mountpoint
	// so the agent doesn't see a stale `/mnt/memory/<id>/` directory hanging
	// around after detach. Uses os.Remove (not RemoveAll) so we never recurse
	// into anything unexpected — a non-empty mountpoint indicates the unmount
	// didn't fully tear down and we'd rather surface that than wipe data.
	if err := os.Remove(mt.mountpoint); err != nil && !os.IsNotExist(err) {
		m.log.Warn("mountpoint rmdir failed", "store_id", storeID, "mountpoint", mt.mountpoint, "error", err)
	}
	m.log.Info("unmounted", "store_id", storeID, "mountpoint", mt.mountpoint)
	return nil
}

// List returns a snapshot of current mounts. Order is non-deterministic.
type Info struct {
	StoreID    string
	Mountpoint string
	ReadOnly   bool
}

func (m *Manager) List() []Info {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]Info, 0, len(m.mounts))
	for _, mt := range m.mounts {
		out = append(out, Info{StoreID: mt.storeID, Mountpoint: mt.mountpoint, ReadOnly: mt.readOnly})
	}
	return out
}

// Close unmounts everything. Best-effort: logs and continues on errors.
func (m *Manager) Close() {
	m.mu.Lock()
	ids := make([]string, 0, len(m.mounts))
	for id := range m.mounts {
		ids = append(ids, id)
	}
	m.mu.Unlock()
	for _, id := range ids {
		if err := m.Unmount(id); err != nil {
			m.log.Warn("close: unmount error", "store_id", id, "error", err)
		}
	}
}
