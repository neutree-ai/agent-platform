# afs

Manage shared **folders** (AFS shares) and their membership — create/revoke a share, grant/remove member workspaces. This governs *access*; the files inside a share are read/written via `agent-afs-files`.

## Operations

| Method | Path | Summary | Details |
|--------|------|---------|----------|
| GET | `/api/workspaces/{id}/afs/shares` | List shared folders visible to this workspace (owner or member). | [View](../operations/get-api-workspaces-id-afs-shares.md) |
| POST | `/api/workspaces/{id}/afs/shares` | Create a shared folder owned by this workspace. Idempotent on name. | [View](../operations/post-api-workspaces-id-afs-shares.md) |
| DELETE | `/api/workspaces/{id}/afs/shares/{shareId}` | Revoke a shared folder. Force-unmounts every member. | [View](../operations/delete-api-workspaces-id-afs-shares-shareId.md) |
| GET | `/api/workspaces/{id}/afs/shares/{shareId}/members` | List share members. | [View](../operations/get-api-workspaces-id-afs-shares-shareId-members.md) |
| POST | `/api/workspaces/{id}/afs/shares/{shareId}/members` | Grant another workspace access to this share. Owner only. | [View](../operations/post-api-workspaces-id-afs-shares-shareId-members.md) |
| DELETE | `/api/workspaces/{id}/afs/shares/{shareId}/members/{memberWorkspaceId}` | Remove a member. Owner can remove any member; a member can remove themselves (leave). | [View](../operations/delete-api-workspaces-id-afs-shares-shareId-members-memberWorkspaceId.md) |
