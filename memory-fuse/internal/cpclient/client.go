// Package cpclient is a thin HTTP client for the NAP control-plane memory
// store API. It speaks the cluster-internal /_cp/* surface (no auth, trusted
// network) — list memories, fetch a memory by path, write a memory at a
// path, and delete one. Identity comes from the workspace_id baked into
// each URL; cp resolves the attachment row to authorise.
package cpclient

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Client struct {
	baseURL     string
	workspaceID string
	storeID     string
	http        *http.Client
}

type Options struct {
	BaseURL     string
	WorkspaceID string
	StoreID     string
	Timeout     time.Duration
}

func New(opt Options) *Client {
	timeout := opt.Timeout
	if timeout == 0 {
		timeout = 15 * time.Second
	}
	return &Client{
		baseURL:     strings.TrimRight(opt.BaseURL, "/"),
		workspaceID: opt.WorkspaceID,
		storeID:     opt.StoreID,
		http:        &http.Client{Timeout: timeout},
	}
}

// Attachment mirrors one row of cp's GET /internal/workspaces/:id/memory-attachments
// response. Daemon pulls this list on boot to learn what to mount initially.
// Mount path is derived as /mnt/memory/<StoreID>/.
type Attachment struct {
	StoreID      string `json:"store_id"`
	Access       string `json:"access"` // "read_only" | "read_write"
	Instructions string `json:"instructions"`
}

// ListWorkspaceAttachments fetches the initial mount set for a workspace from
// cp's unauthenticated internal endpoint. The internal sub-app is mounted at
// /_cp inside cp (not /internal — that prefix bounces through auth middleware
// and returns HTML). Trust comes from cluster network isolation, mirroring
// the afs-fuse pattern.
func ListWorkspaceAttachments(ctx context.Context, baseURL, workspaceID string) ([]Attachment, error) {
	u := fmt.Sprintf("%s/_cp/workspaces/%s/memory-attachments",
		strings.TrimRight(baseURL, "/"), workspaceID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if err := check(resp); err != nil {
		return nil, err
	}
	var out struct {
		Attachments []Attachment `json:"attachments"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	return out.Attachments, nil
}

// MemoryLite mirrors ApiMemoryLite — fields needed for tree/getattr; no body.
type MemoryLite struct {
	ID            string `json:"id"`
	StoreID       string `json:"store_id"`
	Path          string `json:"path"`
	ContentSHA256 string `json:"content_sha256"`
	SizeBytes     int64  `json:"size_bytes"`
	Description   string `json:"description"`
	UpdatedAt     string `json:"updated_at"`
	CreatedAt     string `json:"created_at"`
}

// Memory mirrors ApiMemory — adds the file body.
type Memory struct {
	MemoryLite
	Content string `json:"content"`
}

// ErrNotFound is returned when the server responds 404.
var ErrNotFound = errors.New("memory not found")

// ErrConflict is returned when the server responds 409 (path already exists,
// e.g. a non-overwrite move onto an occupied destination).
var ErrConflict = errors.New("memory already exists at path")

// ErrPrecondition is returned when the server responds 412 (sha mismatch).
// CurrentSHA256 carries the server's current hash, suitable for retry.
type ErrPrecondition struct {
	CurrentSHA256 string
}

func (e *ErrPrecondition) Error() string { return "sha256 precondition failed" }

func (c *Client) ListMemories(ctx context.Context) ([]MemoryLite, error) {
	u := fmt.Sprintf("%s/_cp/workspaces/%s/memory-stores/%s/memories",
		c.baseURL, c.workspaceID, c.storeID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if err := check(resp); err != nil {
		return nil, err
	}
	var out struct {
		Memories []MemoryLite `json:"memories"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	return out.Memories, nil
}

// GetMemory fetches a memory by absolute path (must start with "/").
func (c *Client) GetMemory(ctx context.Context, path string) (*Memory, error) {
	u, err := c.memoryURL(path)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if err := check(resp); err != nil {
		return nil, err
	}
	var m Memory
	if err := json.NewDecoder(resp.Body).Decode(&m); err != nil {
		return nil, err
	}
	return &m, nil
}

// PutMemory writes content at path with optional sha256 precondition.
// Pass an empty string for ifMatchSHA256 to assert "must not exist".
func (c *Client) PutMemory(ctx context.Context, path, content, ifMatchSHA256 string) (*Memory, error) {
	body, _ := json.Marshal(map[string]any{
		"content":          content,
		"if_match_sha256":  ifMatchSHA256,
	})
	u, err := c.memoryURL(path)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, u, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if err := check(resp); err != nil {
		return nil, err
	}
	var m Memory
	if err := json.NewDecoder(resp.Body).Decode(&m); err != nil {
		return nil, err
	}
	return &m, nil
}

// DeleteMemory removes the memory at path. Empty ifMatchSHA256 skips
// the precondition.
func (c *Client) DeleteMemory(ctx context.Context, path, ifMatchSHA256 string) error {
	body, _ := json.Marshal(map[string]any{"if_match_sha256": ifMatchSHA256})
	u, err := c.memoryURL(path)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, u, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return check(resp)
}

// MoveMemory atomically renames the memory at fromPath to toPath on the server,
// preserving the memory's identity. overwrite=true replaces an existing memory
// at toPath (the editor write-temp-then-rename atomic-save path); false makes a
// collision return ErrPrecondition-free 409 surfaced as a generic error. Pass a
// non-empty ifMatchSHA256 to assert fromPath's current sha.
func (c *Client) MoveMemory(ctx context.Context, fromPath, toPath string, overwrite bool, ifMatchSHA256 string) (*Memory, error) {
	if !strings.HasPrefix(fromPath, "/") || !strings.HasPrefix(toPath, "/") {
		return nil, fmt.Errorf("paths must start with /: %q -> %q", fromPath, toPath)
	}
	body, _ := json.Marshal(map[string]any{
		"from":            fromPath,
		"to":              toPath,
		"overwrite":       overwrite,
		"if_match_sha256": ifMatchSHA256,
	})
	u := fmt.Sprintf("%s/_cp/workspaces/%s/memory-stores/%s/memory-move",
		c.baseURL, c.workspaceID, c.storeID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if err := check(resp); err != nil {
		return nil, err
	}
	var m Memory
	if err := json.NewDecoder(resp.Body).Decode(&m); err != nil {
		return nil, err
	}
	return &m, nil
}

func (c *Client) memoryURL(path string) (string, error) {
	if !strings.HasPrefix(path, "/") {
		return "", fmt.Errorf("path must start with /: %q", path)
	}
	// /_cp/workspaces/<wsId>/memory-stores/<storeId>/memory/<path-without-leading-slash>
	parts := strings.Split(strings.TrimPrefix(path, "/"), "/")
	for i, p := range parts {
		parts[i] = url.PathEscape(p)
	}
	return fmt.Sprintf("%s/_cp/workspaces/%s/memory-stores/%s/memory/%s",
		c.baseURL, c.workspaceID, c.storeID, strings.Join(parts, "/")), nil
}

func check(resp *http.Response) error {
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return nil
	}
	if resp.StatusCode == http.StatusNotFound {
		return ErrNotFound
	}
	if resp.StatusCode == http.StatusConflict {
		return ErrConflict
	}
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode == http.StatusPreconditionFailed {
		var p struct {
			CurrentSHA256 string `json:"current_sha256"`
		}
		_ = json.Unmarshal(body, &p)
		return &ErrPrecondition{CurrentSHA256: p.CurrentSHA256}
	}
	return fmt.Errorf("cp http %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
}
