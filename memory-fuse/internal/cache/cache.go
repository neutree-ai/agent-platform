// Package cache is a disk-backed content cache for memory store files. It
// survives daemon restarts within the same pod (cache root is an emptyDir
// mount that lives with the pod) and is invalidated by either the cp-pushed
// Invalidate RPC or a sha mismatch against the snapshot.
//
// Layout under cache root:
//
//	<root>/<storeID>/<memory-path>        -- file content (path mirrors the
//	                                          memory path verbatim; daemon
//	                                          rejects ".." segments)
//	<root>/<storeID>/<memory-path>.sha    -- ASCII hex sha256 of content
//
// Atomicity: writes go to a sibling `.tmp` and rename into place; readers
// either see the previous version, the new version, or NotFound — never a
// torn file. Invalidate of a whole store renames the store dir to a tmp
// name and rm -rf in the background, so cp can return immediately.
package cache

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

type Cache struct {
	root string

	// Per-(storeID, path) write serialization. Reads run lock-free; the
	// sha-on-disk match is what protects against torn updates.
	mu     sync.Mutex
	locks  map[string]*sync.Mutex
}

func New(root string) (*Cache, error) {
	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, fmt.Errorf("mkdir cache root %s: %w", root, err)
	}
	return &Cache{root: root, locks: map[string]*sync.Mutex{}}, nil
}

func (c *Cache) lock(key string) func() {
	c.mu.Lock()
	m, ok := c.locks[key]
	if !ok {
		m = &sync.Mutex{}
		c.locks[key] = m
	}
	c.mu.Unlock()
	m.Lock()
	return m.Unlock
}

// Get returns the cached content for (storeID, path) if and only if the
// on-disk sha matches expectedSHA. Returns nil,false on miss / mismatch /
// IO error (caller falls back to remote fetch). expectedSHA is the
// authoritative sha from the snapshot — without it we have no way to know
// the cache entry is still fresh.
func (c *Cache) Get(storeID, path, expectedSHA string) ([]byte, bool) {
	contentPath, shaPath, err := c.paths(storeID, path)
	if err != nil {
		return nil, false
	}
	shaBytes, err := os.ReadFile(shaPath)
	if err != nil {
		return nil, false
	}
	if strings.TrimSpace(string(shaBytes)) != expectedSHA {
		return nil, false
	}
	content, err := os.ReadFile(contentPath)
	if err != nil {
		return nil, false
	}
	return content, true
}

// Put atomically writes content + sha for (storeID, path). The cache promise
// is "if you read back this entry and the sha matches what you expect, the
// content is what was written here." A best-effort write — IO errors are
// returned so callers can log, but a miss next time around just means a
// re-fetch.
func (c *Cache) Put(storeID, path, sha string, content []byte) error {
	contentPath, shaPath, err := c.paths(storeID, path)
	if err != nil {
		return err
	}
	unlock := c.lock(storeID + "\x00" + path)
	defer unlock()

	if err := os.MkdirAll(filepath.Dir(contentPath), 0o755); err != nil {
		return err
	}
	if err := atomicWrite(contentPath, content); err != nil {
		return err
	}
	return atomicWrite(shaPath, []byte(sha))
}

// Drop removes the entry for (storeID, path) — used when the agent deletes a
// memory and the daemon wants to drop the disk footprint immediately rather
// than waiting for the parent dir's Invalidate.
func (c *Cache) Drop(storeID, path string) error {
	contentPath, shaPath, err := c.paths(storeID, path)
	if err != nil {
		return err
	}
	unlock := c.lock(storeID + "\x00" + path)
	defer unlock()
	_ = os.Remove(shaPath)
	if err := os.Remove(contentPath); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	return nil
}

// Invalidate drops the entire on-disk cache for a store. To stay snappy
// under cp's fire-and-forget broadcast, we rename the dir aside first
// (instantly hides it from future reads) and rm -rf in a goroutine.
func (c *Cache) Invalidate(storeID string) error {
	dir := filepath.Join(c.root, storeID)
	stash := dir + ".invalidating." + randSuffix()
	if err := os.Rename(dir, stash); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		return err
	}
	go func() { _ = os.RemoveAll(stash) }()
	return nil
}

// PruneExcept removes top-level cache subdirs for stores not in `keep`. Run
// after boot pull so stores detached while the daemon was down don't leak
// stale content on disk. `keep` is a slice rather than a set since N is
// always small (≤ workspace attachment cap).
func (c *Cache) PruneExcept(keep []string) error {
	entries, err := os.ReadDir(c.root)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		return err
	}
	keepSet := map[string]bool{}
	for _, k := range keep {
		keepSet[k] = true
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		if keepSet[e.Name()] {
			continue
		}
		// Tolerate the `.invalidating.*` rename targets and any other junk
		// the cache layer may have left behind — they're not attached so
		// drop them too.
		_ = os.RemoveAll(filepath.Join(c.root, e.Name()))
	}
	return nil
}

func (c *Cache) paths(storeID, memPath string) (content, sha string, err error) {
	if storeID == "" {
		return "", "", errors.New("empty storeID")
	}
	if strings.ContainsRune(storeID, '/') || storeID == ".." || storeID == "." {
		return "", "", fmt.Errorf("invalid storeID: %q", storeID)
	}
	if !strings.HasPrefix(memPath, "/") {
		return "", "", fmt.Errorf("memory path must start with /: %q", memPath)
	}
	// Forbid traversal. memory paths are server-controlled and should already
	// be sane, but a malformed snapshot could land us writing outside the
	// store dir without this guard.
	clean := filepath.Clean(memPath)
	if clean == "/" || strings.HasPrefix(clean, "/../") || strings.Contains(clean, "/../") || strings.HasSuffix(clean, "/..") {
		return "", "", fmt.Errorf("invalid memory path: %q", memPath)
	}
	content = filepath.Join(c.root, storeID, strings.TrimPrefix(clean, "/"))
	sha = content + ".sha"
	return content, sha, nil
}

func atomicWrite(path string, data []byte) error {
	tmp := path + ".tmp." + randSuffix()
	f, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	if _, err := f.Write(data); err != nil {
		f.Close()
		_ = os.Remove(tmp)
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		_ = os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, path)
}
