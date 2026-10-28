# POST /api/workspaces/{id}/afs/mounts

**Resource:** [afs](../resources/afs.md)
**Mount another user's folder, granted to a team the workspace's owner is in, or change the permission of such a mount. A running workspace mounts it right away; a stopped one when it starts. Leave it with DELETE /{id}/afs/shares/{shareId}/members/{id}.**
**Operation ID:** `post--api-workspaces-{id}-afs-mounts`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `share_id` | string | Yes |  |
| `permission` | enum: read_only, read_write | No |  |
| `mount_name` | string | No | Where to mount it, /mnt/afs/<mount_name>; the folder's own name when omitted. |

## Responses

| Status | Description |
|--------|-------------|
| 201 | Mounted |
| 400 | Workspace on another environment |
| 403 | Not granted, or not at that permission |
| 404 | Not found |
| 409 | A folder is already mounted at that name |
| 502 | afs mount failed |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `share_id` | string | Yes |  |
| `permission` | enum: read_only, read_write | Yes |  |
| `mount_name` | string | Yes |  |

## Security

- **bearerAuth**
