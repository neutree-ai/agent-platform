# GET /api/workspaces/{id}/transfer

**Resource:** [workspaces](../resources/workspaces.md)
**The workspace's pending transfer, if any**
**Operation ID:** `get--api-workspaces-{id}-transfer`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Pending transfer, or null |
| 404 | Not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes |  |
| `workspace_id` | string | Yes |  |
| `workspace_name` | string | Yes |  |
| `from_user` | object | Yes |  |
| `to_user` | object | Yes |  |
| `initiated_by` | string | Yes |  |
| `status` | enum: pending, executing, completed... | Yes |  |
| `copy` | object | Yes |  |
| `error` | string,null | Yes |  |
| `created_at` | string | Yes |  |
| `expires_at` | string | Yes |  |
| `resolved_at` | string,null | Yes |  |

**`from_user` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes |  |
| `username` | string | Yes |  |
| `display_name` | string | Yes |  |

**`to_user` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes |  |
| `username` | string | Yes |  |
| `display_name` | string | Yes |  |

**`copy` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `prompts` | string[] | Yes |  |
| `skills` | string[] | Yes |  |

## Security

- **bearerAuth**
