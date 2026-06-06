# GET /api/workspaces/{id}/sessions

**Resource:** [workspaces](../resources/workspaces.md)
**List sessions for a workspace**
**Operation ID:** `get--api-workspaces-{id}-sessions`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `limit` | query | integer | No |  |
| `offset` | query | integer,null | No |  |
| `starred` | query | enum: true, false | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Paginated session list |
| 404 | Workspace not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `items` | object[] | Yes |  |
| `total` | integer | Yes |  |

**`items` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes |  |
| `workspace_id` | string | Yes |  |
| `name` | string | Yes |  |
| `status` | string | Yes |  |
| `chat_status` | string | Yes |  |
| `created_at` | string | Yes |  |
| `last_active_at` | string | Yes |  |
| `message_count` | integer | Yes |  |
| `preview` | string | Yes |  |
| `last_turn_stats` | object,null | Yes |  |
| `starred_at` | string,null | Yes |  |

## Security

- **bearerAuth**
