# GET /api/workspaces/{id}/afs/shares/{shareId}/members

**Resource:** [afs](../resources/afs.md)
**List share members. The owner sees every member; a member sees the ones of its own owner's.**
**Operation ID:** `get--api-workspaces-{id}-afs-shares-{shareId}-members`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `shareId` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Members |
| 404 | Not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `members` | object[] | Yes |  |

**`members` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `workspace_id` | string | Yes |  |
| `permission` | enum: read_only, read_write | Yes |  |
| `mounted_at` | string | Yes |  |
| `source` | enum: direct, team | Yes |  |
| `mount_name` | string | Yes |  |
| `workspace_name` | string | Yes |  |
| `user_id` | string | Yes |  |
| `user_display_name` | string | Yes |  |

## Security

- **bearerAuth**
