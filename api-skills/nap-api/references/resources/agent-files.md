# agent-files

File operations on the **workspace's own filesystem** (the agent's working dir). The `path` query param is relative to the FS root — no leading slash, inner slashes are nested dirs; URL-encode the value. Also mints short-lived public file URLs (export-url). For the cross-workspace shared volume use `agent-afs-files` instead.

## Operations

| Method | Path | Summary | Details |
|--------|------|---------|----------|
| GET | `/api/workspaces/{id}/agent/files` | Read a file from the workspace filesystem | [View](../operations/get-api-workspaces-id-agent-files.md) |
| PUT | `/api/workspaces/{id}/agent/files` | Write (create or overwrite) a file | [View](../operations/put-api-workspaces-id-agent-files.md) |
| DELETE | `/api/workspaces/{id}/agent/files` | Delete a file or directory (recursive) | [View](../operations/delete-api-workspaces-id-agent-files.md) |
| GET | `/api/workspaces/{id}/agent/files/preview` | Render an Office document (pptx/docx/xlsx/…) to PDF | [View](../operations/get-api-workspaces-id-agent-files-preview.md) |
| GET | `/api/workspaces/{id}/agent/dirs` | List directory entries | [View](../operations/get-api-workspaces-id-agent-dirs.md) |
| POST | `/api/workspaces/{id}/agent/dirs` | Create a directory | [View](../operations/post-api-workspaces-id-agent-dirs.md) |
| GET | `/api/workspaces/{id}/agent/dirs/zip` | Download a directory as a zip archive | [View](../operations/get-api-workspaces-id-agent-dirs-zip.md) |
| POST | `/api/workspaces/{id}/agent/move` | Move or rename a file or directory | [View](../operations/post-api-workspaces-id-agent-move.md) |
| POST | `/api/workspaces/{id}/agent/export-url` | Mint a short-lived public URL for a workspace file | [View](../operations/post-api-workspaces-id-agent-export-url.md) |
| GET | `/api/workspaces/{id}/agent/export-tokens` | List active public file URLs for a workspace | [View](../operations/get-api-workspaces-id-agent-export-tokens.md) |
| DELETE | `/api/workspaces/{id}/agent/export-tokens/{token}` | Revoke (hard-delete) a public file URL | [View](../operations/delete-api-workspaces-id-agent-export-tokens-token.md) |
