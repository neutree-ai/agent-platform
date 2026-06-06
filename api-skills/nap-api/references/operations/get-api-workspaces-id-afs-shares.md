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
| `created_at` | string | Yes |  |

## Security

- **bearerAuth**
