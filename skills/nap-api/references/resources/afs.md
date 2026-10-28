# afs

Manage shared **folders** (AFS shares) and their membership — create/revoke a share, grant/remove member workspaces. This governs *access*; the files inside a share are read/written via `agent-afs-files`.

## Operations

| Method | Path | Summary | Details |
|--------|------|---------|----------|
| GET | `/api/workspaces/{id}/afs/shares` | List shared folders visible to this workspace (owner or member). | [View](../operations/get-api-workspaces-id-afs-shares.md) |
| POST | `/api/workspaces/{id}/afs/shares` | Create a shared folder owned by this workspace. Idempotent on name. | [View](../operations/post-api-workspaces-id-afs-shares.md) |
| DELETE | `/api/workspaces/{id}/afs/shares/{shareId}` | Revoke a shared folder. Force-unmounts every member. | [View](../operations/delete-api-workspaces-id-afs-shares-shareId.md) |
| GET | `/api/workspaces/{id}/afs/shares/{shareId}/members` | List share members. The owner sees every member; a member sees the ones of its own owner's. | [View](../operations/get-api-workspaces-id-afs-shares-shareId-members.md) |
| POST | `/api/workspaces/{id}/afs/shares/{shareId}/members` | Grant another workspace access to this share. Owner only. | [View](../operations/post-api-workspaces-id-afs-shares-shareId-members.md) |
| DELETE | `/api/workspaces/{id}/afs/shares/{shareId}/members/{memberWorkspaceId}` | Remove a member. Owner can remove any member; a member can remove themselves (leave). | [View](../operations/delete-api-workspaces-id-afs-shares-shareId-members-memberWorkspaceId.md) |
| GET | `/api/workspaces/{id}/afs/shares/{shareId}/grants` | List the teams a folder is granted to. Owner only. | [View](../operations/get-api-workspaces-id-afs-shares-shareId-grants.md) |
| PUT | `/api/workspaces/{id}/afs/shares/{shareId}/grants/{teamId}` | Grant a folder to a team the owner is in, or change the grant's permission. Members of the team can then mount it in their workspaces, at up to that permission; lowering it takes effect on their mounts. | [View](../operations/put-api-workspaces-id-afs-shares-shareId-grants-teamId.md) |
| DELETE | `/api/workspaces/{id}/afs/shares/{shareId}/grants/{teamId}` | Take a folder's grant from a team. Mounts no other grant allows are unmounted. Owner only. | [View](../operations/delete-api-workspaces-id-afs-shares-shareId-grants-teamId.md) |
| GET | `/api/workspaces/{id}/afs/available` | Other users' folders granted to a team the workspace's owner is in, that the workspace doesn't have yet. | [View](../operations/get-api-workspaces-id-afs-available.md) |
| POST | `/api/workspaces/{id}/afs/mounts` | Mount another user's folder, granted to a team the workspace's owner is in, or change the permission of such a mount. A running workspace mounts it right away; a stopped one when it starts. Leave it with DELETE /{id}/afs/shares/{shareId}/members/{id}. | [View](../operations/post-api-workspaces-id-afs-mounts.md) |
