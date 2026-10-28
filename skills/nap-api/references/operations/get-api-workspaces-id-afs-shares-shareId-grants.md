# GET /api/workspaces/{id}/afs/shares/{shareId}/grants

**Resource:** [afs](../resources/afs.md)
**List the teams a folder is granted to. Owner only.**
**Operation ID:** `get--api-workspaces-{id}-afs-shares-{shareId}-grants`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `shareId` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Grants |
| 403 | Not owner |
| 404 | Not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `grants` | object[] | Yes |  |

**`grants` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `team_id` | string | Yes |  |
| `team_name` | string | Yes |  |
| `permission` | enum: read_only, read_write | Yes | The highest permission team members can mount it at. |
| `granted_at` | string | Yes |  |

## Security

- **bearerAuth**
