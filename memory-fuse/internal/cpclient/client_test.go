package cpclient

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

// capture records the request a handler saw so tests can assert URL/method/body.
type capture struct {
	method string
	path   string
	body   map[string]any
}

func newServer(t *testing.T, status int, respBody string, cap *capture) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if cap != nil {
			cap.method = r.Method
			cap.path = r.URL.EscapedPath()
			if b, _ := io.ReadAll(r.Body); len(b) > 0 {
				_ = json.Unmarshal(b, &cap.body)
			}
		}
		w.WriteHeader(status)
		_, _ = io.WriteString(w, respBody)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func testClient(base string) *Client {
	return New(Options{BaseURL: base, WorkspaceID: "ws1", StoreID: "st1"})
}

func TestListMemories(t *testing.T) {
	var cap capture
	srv := newServer(t, 200, `{"memories":[{"path":"/a.md","content_sha256":"sha","size_bytes":3}]}`, &cap)
	got, err := testClient(srv.URL).ListMemories(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if cap.path != "/_cp/workspaces/ws1/memory-stores/st1/memories" {
		t.Errorf("path = %q", cap.path)
	}
	if len(got) != 1 || got[0].Path != "/a.md" || got[0].ContentSHA256 != "sha" {
		t.Errorf("got %+v", got)
	}
}

func TestGetMemoryEscapesPathAnd404(t *testing.T) {
	var cap capture
	srv := newServer(t, 200, `{"path":"/notes/foo bar.md","content":"hi","content_sha256":"s"}`, &cap)
	m, err := testClient(srv.URL).GetMemory(context.Background(), "/notes/foo bar.md")
	if err != nil {
		t.Fatal(err)
	}
	if cap.path != "/_cp/workspaces/ws1/memory-stores/st1/memory/notes/foo%20bar.md" {
		t.Errorf("path not escaped: %q", cap.path)
	}
	if m.Content != "hi" {
		t.Errorf("content = %q", m.Content)
	}

	srv404 := newServer(t, 404, `{"error":"memory not found"}`, nil)
	if _, err := testClient(srv404.URL).GetMemory(context.Background(), "/x.md"); !errors.Is(err, ErrNotFound) {
		t.Errorf("want ErrNotFound, got %v", err)
	}
}

func TestPutMemoryBodyAndPrecondition(t *testing.T) {
	var cap capture
	srv := newServer(t, 200, `{"path":"/a.md","content":"body","content_sha256":"new"}`, &cap)
	_, err := testClient(srv.URL).PutMemory(context.Background(), "/a.md", "body", "old")
	if err != nil {
		t.Fatal(err)
	}
	if cap.method != http.MethodPut {
		t.Errorf("method = %q", cap.method)
	}
	if cap.body["content"] != "body" || cap.body["if_match_sha256"] != "old" {
		t.Errorf("body = %+v", cap.body)
	}

	srv412 := newServer(t, 412, `{"current_sha256":"server-sha"}`, nil)
	_, err = testClient(srv412.URL).PutMemory(context.Background(), "/a.md", "b", "stale")
	var pre *ErrPrecondition
	if !errors.As(err, &pre) {
		t.Fatalf("want ErrPrecondition, got %v", err)
	}
	if pre.CurrentSHA256 != "server-sha" {
		t.Errorf("current sha = %q", pre.CurrentSHA256)
	}
}

func TestDeleteMemoryPrecondition(t *testing.T) {
	var cap capture
	srv := newServer(t, 200, `{"success":true}`, &cap)
	if err := testClient(srv.URL).DeleteMemory(context.Background(), "/a.md", "sha"); err != nil {
		t.Fatal(err)
	}
	if cap.method != http.MethodDelete || cap.body["if_match_sha256"] != "sha" {
		t.Errorf("method=%q body=%+v", cap.method, cap.body)
	}

	srv412 := newServer(t, 412, `{"current_sha256":"s"}`, nil)
	err := testClient(srv412.URL).DeleteMemory(context.Background(), "/a.md", "stale")
	var pre *ErrPrecondition
	if !errors.As(err, &pre) {
		t.Errorf("want ErrPrecondition, got %v", err)
	}
}

func TestMoveMemory(t *testing.T) {
	var cap capture
	srv := newServer(t, 200, `{"path":"/b.md","content":"x","content_sha256":"s"}`, &cap)
	m, err := testClient(srv.URL).MoveMemory(context.Background(), "/a.md", "/b.md", true, "")
	if err != nil {
		t.Fatal(err)
	}
	if cap.method != http.MethodPost {
		t.Errorf("method = %q", cap.method)
	}
	if cap.path != "/_cp/workspaces/ws1/memory-stores/st1/memory-move" {
		t.Errorf("path = %q", cap.path)
	}
	if cap.body["from"] != "/a.md" || cap.body["to"] != "/b.md" || cap.body["overwrite"] != true {
		t.Errorf("body = %+v", cap.body)
	}
	if m.Path != "/b.md" {
		t.Errorf("returned path = %q", m.Path)
	}
}

func TestMoveMemoryErrorMapping(t *testing.T) {
	cases := []struct {
		status  int
		body    string
		wantIs  error
		wantPre bool
	}{
		{404, `{"error":"memory not found"}`, ErrNotFound, false},
		{409, `{"error":"memory already exists at destination"}`, ErrConflict, false},
		{412, `{"current_sha256":"s"}`, nil, true},
	}
	for _, tc := range cases {
		srv := newServer(t, tc.status, tc.body, nil)
		_, err := testClient(srv.URL).MoveMemory(context.Background(), "/a.md", "/b.md", false, "")
		if tc.wantPre {
			var pre *ErrPrecondition
			if !errors.As(err, &pre) {
				t.Errorf("status %d: want ErrPrecondition, got %v", tc.status, err)
			}
			continue
		}
		if !errors.Is(err, tc.wantIs) {
			t.Errorf("status %d: want %v, got %v", tc.status, tc.wantIs, err)
		}
	}
}

func TestMoveMemoryRejectsRelativePaths(t *testing.T) {
	srv := newServer(t, 200, `{}`, nil)
	if _, err := testClient(srv.URL).MoveMemory(context.Background(), "a.md", "/b.md", true, ""); err == nil {
		t.Error("want error for non-absolute from path")
	}
}

func TestListWorkspaceAttachments(t *testing.T) {
	var cap capture
	srv := newServer(t, 200, `{"attachments":[{"store_id":"st1","access":"read_only","instructions":"x"}]}`, &cap)
	got, err := ListWorkspaceAttachments(context.Background(), srv.URL, "ws1")
	if err != nil {
		t.Fatal(err)
	}
	if cap.path != "/_cp/workspaces/ws1/memory-attachments" {
		t.Errorf("path = %q", cap.path)
	}
	if len(got) != 1 || got[0].StoreID != "st1" || got[0].Access != "read_only" {
		t.Errorf("got %+v", got)
	}
}
