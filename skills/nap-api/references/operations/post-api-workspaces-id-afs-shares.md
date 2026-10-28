# POST /api/workspaces/{id}/afs/shares

**Resource:** [afs](../resources/afs.md)
**Create a shared folder owned by this workspace. Idempotent on name.**
**Operation ID:** `post--api-workspaces-{id}-afs-shares`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Human-readable folder name; lowercase letters/digits/hyphens, ≤48 chars. |

## Responses

| Status | Description |
|--------|-------------|
| 201 | Created |
| 400 | Invalid name |
| 404 | Not found |
| 409 | A folder is already mounted at that name |
| 502 | afs unavailable |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes |  |
| `name` | string | Yes |  |
| `owner_workspace_id` | string | Yes |  |
| `afs_dir_id` | string | Yes |  |
| `role` | enum: owner, member | Yes |  |
| `my_permission` | enum: read_only, read_write | Yes |  |
| `mount_name` | string | Yes | Where this workspace has the folder: /mnt/afs/<mount_name>. |
| `source` | enum: direct, team | Yes | 'team': this workspace has the folder through a grant to a team. |
| `owner_user_id` | string | Yes |  |
| `owner_display_name` | string | Yes |  |
| `other_member_count` | number | Yes | Workspaces other than the owner's that have it. |
| `grant_count` | number | Yes | Teams the folder is granted to. |
| `created_at` | string | Yes |  |

## Security

- **bearerAuth**
