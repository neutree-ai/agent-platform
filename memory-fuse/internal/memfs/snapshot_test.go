package memfs

import (
	"sort"
	"testing"

	"github.com/neutree-ai/agent-platform/memory-fuse/internal/cpclient"
)

func lite(path, sha string, size int64) cpclient.MemoryLite {
	return cpclient.MemoryLite{Path: path, ContentSHA256: sha, SizeBytes: size}
}

func sortedDir(s *snapshot, dir string) []string {
	names, ok := s.listDir(dir)
	if !ok {
		return nil
	}
	sort.Strings(names)
	return names
}

func TestSnapshotLoadSynthesisesTree(t *testing.T) {
	s := newSnapshot()
	s.load([]cpclient.MemoryLite{
		lite("/MEMORY.md", "a", 10),
		lite("/notes/foo.md", "b", 20),
		lite("/notes/sub/bar.md", "c", 30),
	})

	if got := sortedDir(s, "/"); !equal(got, []string{"MEMORY.md", "notes"}) {
		t.Fatalf("root listing = %v", got)
	}
	if got := sortedDir(s, "/notes"); !equal(got, []string{"foo.md", "sub"}) {
		t.Fatalf("/notes listing = %v", got)
	}
	if got := sortedDir(s, "/notes/sub"); !equal(got, []string{"bar.md"}) {
		t.Fatalf("/notes/sub listing = %v", got)
	}

	// dirs report as dirs, files as files
	for _, d := range []string{"/", "/notes", "/notes/sub"} {
		if !s.isDir(d) {
			t.Errorf("%s should be a dir", d)
		}
	}
	for _, f := range []string{"/MEMORY.md", "/notes/foo.md", "/notes/sub/bar.md"} {
		if s.isDir(f) {
			t.Errorf("%s should not be a dir", f)
		}
		if _, ok := s.file(f); !ok {
			t.Errorf("%s should be a file", f)
		}
	}
}

func TestSnapshotReloadReplacesState(t *testing.T) {
	s := newSnapshot()
	s.load([]cpclient.MemoryLite{lite("/a/old.md", "1", 1)})
	s.load([]cpclient.MemoryLite{lite("/b/new.md", "2", 2)})

	if _, ok := s.file("/a/old.md"); ok {
		t.Error("stale file survived reload")
	}
	if s.isDir("/a") {
		t.Error("stale dir /a survived reload")
	}
	if _, ok := s.file("/b/new.md"); !ok {
		t.Error("new file missing after reload")
	}
}

func TestEphemeralDirVisibleThenGraduates(t *testing.T) {
	s := newSnapshot()
	s.load(nil)

	s.addEphemeralDir("/a")
	s.addEphemeralDir("/a/b")
	s.addEphemeralDir("/keep") // sibling with no descendant memory
	if !s.isDir("/a") || !s.isDir("/a/b") || !s.isDir("/keep") {
		t.Fatal("ephemeral dirs not visible")
	}
	if got := sortedDir(s, "/"); !equal(got, []string{"a", "keep"}) {
		t.Fatalf("root listing = %v, want [a keep]", got)
	}
	if got := sortedDir(s, "/a"); !equal(got, []string{"b"}) {
		t.Fatalf("/a listing = %v, want [b]", got)
	}

	// A memory lands under /a/b: the path makes both /a and /a/b real ancestor
	// dirs, so both graduate out of the ephemeral set. /keep has no descendant
	// memory, so it survives the reload as ephemeral.
	s.load([]cpclient.MemoryLite{lite("/a/b/c.md", "x", 5)})
	if s.ephemeral["/a"] || s.ephemeral["/a/b"] {
		t.Error("/a and /a/b should have graduated out of ephemeral")
	}
	if !s.ephemeral["/keep"] {
		t.Error("/keep should still be ephemeral after reload")
	}
	if !s.isDir("/a") || !s.isDir("/a/b") || !s.isDir("/keep") {
		t.Error("all dirs should still be visible after reload")
	}
	if got := sortedDir(s, "/a/b"); !equal(got, []string{"c.md"}) {
		t.Fatalf("/a/b listing = %v", got)
	}
}

func TestRemoveEphemeralDir(t *testing.T) {
	s := newSnapshot()
	s.load(nil)
	s.addEphemeralDir("/tmp")

	if ok := s.removeEphemeralDir("/tmp"); !ok {
		t.Fatal("removeEphemeralDir returned false for an ephemeral dir")
	}
	if s.isDir("/tmp") {
		t.Error("/tmp still visible after removal")
	}
	if got, _ := s.listDir("/"); len(got) != 0 {
		t.Errorf("root should be empty, got %v", got)
	}

	// A real (memory-backed) dir is not removable via the ephemeral path.
	s.load([]cpclient.MemoryLite{lite("/real/x.md", "y", 1)})
	if s.removeEphemeralDir("/real") {
		t.Error("removeEphemeralDir should refuse a memory-backed dir")
	}
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
