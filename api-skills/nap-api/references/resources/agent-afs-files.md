# agent-afs-files

File operations on the **shared AFS volume mounted at `/mnt/afs`**, visible to every workspace granted access. Use this (not `agent-files`) when data must be shared across workspaces or outlive one workspace. Same path rules as `agent-files`. To manage who can access a shared folder, use the `afs` resource.

## Operations

| Method | Path | Summary | Details |
|--------|------|---------|----------|
| GET | `/api/workspaces/{id}/agent/afs-files` | Read a file from the AgentFS shared mounts (/mnt/afs) | [View](../operations/get-api-workspaces-id-agent-afs-files.md) |
| PUT | `/api/workspaces/{id}/agent/afs-files` | Write (create or overwrite) a file | [View](../operations/put-api-workspaces-id-agent-afs-files.md) |
| DELETE | `/api/workspaces/{id}/agent/afs-files` | Delete a file or directory (recursive) | [View](../operations/delete-api-workspaces-id-agent-afs-files.md) |
| GET | `/api/workspaces/{id}/agent/afs-files/preview` | Render an Office document (pptx/docx/xlsx/…) to PDF | [View](../operations/get-api-workspaces-id-agent-afs-files-preview.md) |
| GET | `/api/workspaces/{id}/agent/afs-dirs` | List directory entries | [View](../operations/get-api-workspaces-id-agent-afs-dirs.md) |
| POST | `/api/workspaces/{id}/agent/afs-dirs` | Create a directory | [View](../operations/post-api-workspaces-id-agent-afs-dirs.md) |
| GET | `/api/workspaces/{id}/agent/afs-dirs/zip` | Download a directory as a zip archive | [View](../operations/get-api-workspaces-id-agent-afs-dirs-zip.md) |
| POST | `/api/workspaces/{id}/agent/afs-move` | Move or rename a file or directory | [View](../operations/post-api-workspaces-id-agent-afs-move.md) |
