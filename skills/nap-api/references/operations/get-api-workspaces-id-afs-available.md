# GET /api/workspaces/{id}/afs/available

**Resource:** [afs](../resources/afs.md)
**Other users' folders granted to a team the workspace's owner is in, that the workspace doesn't have yet.**
**Operation ID:** `get--api-workspaces-{id}-afs-available`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Folders |
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
| `owner_user_id` | string | Yes |  |
| `owner_display_name` | string | Yes |  |
| `ceiling` | enum: read_only, read_write | Yes | The highest permission it can be mounted at. |
| `team_names` | string[] | Yes |  |
| `created_at` | string | Yes |  |

## Security

- **bearerAuth**
