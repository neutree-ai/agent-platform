package memfs

import "testing"

func TestValidateMemoryContent(t *testing.T) {
	good := []byte("---\nname: my-mem\ndescription: hi\nmetadata:\n  type: project\n  created: 2026-05-17\n---\n\nbody\n")
	tests := []struct {
		name    string
		path    string
		body    []byte
		wantErr bool
	}{
		{"happy", "/foo.md", good, false},
		{"index skipped", "/MEMORY.md", []byte("- [a](a.md) — x\n"), false},
		{"missing frontmatter", "/foo.md", []byte("just body\n"), true},
		{"unterminated", "/foo.md", []byte("---\nname: x\n"), true},
		{"missing name", "/foo.md", []byte("---\ndescription: hi\nmetadata:\n  type: user\n---\n"), true},
		{"missing type", "/foo.md", []byte("---\nname: x\ndescription: hi\nmetadata:\n  created: 2026-05-17\n---\n"), true},
		{"bad type", "/foo.md", []byte("---\nname: x\ndescription: hi\nmetadata:\n  type: random\n---\n"), true},
		{"all four types accepted", "/foo.md", []byte("---\nname: x\nmetadata:\n  type: feedback\n---\n"), false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := validateMemoryContent(tc.path, tc.body)
			if tc.wantErr && err == nil {
				t.Fatalf("want error, got nil")
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}
