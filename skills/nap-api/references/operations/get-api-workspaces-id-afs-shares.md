# GET /api/workspaces/{id}/afs/shares

**Resource:** [afs](../resources/afs.md)
**List shared folders visible to this workspace (owner or member).**
**Operation ID:** `get--api-workspaces-{id}-afs-shares`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Shares |
| 404 | Not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `shares` | object[] | Yes |  |

**`shares` fields:**

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
