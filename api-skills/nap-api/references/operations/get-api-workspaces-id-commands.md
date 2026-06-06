# GET /api/workspaces/{id}/commands

**Resource:** [workspaces](../resources/workspaces.md)
**List workspace commands**
**Operation ID:** `get--api-workspaces-{id}-commands`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Commands wrapped in `{ commands: [...] }` |
| 404 | Workspace not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `commands` | object[] | Yes |  |

**`commands` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes |  |
| `workspace_id` | string | Yes |  |
| `user_id` | string | Yes |  |
| `name` | string | Yes |  |
| `type` | enum: plain, struct | Yes |  |
| `prompt_id` | string,null | Yes |  |
| `prompt_content` | string,null | Yes |  |
| `content` | string | Yes |  |
| `sort_order` | integer | Yes |  |
| `source` | enum: local, template | Yes |  |
| `disabled` | boolean | Yes |  |
| `created_at` | string | Yes |  |
| `updated_at` | string | Yes |  |

## Security

- **bearerAuth**
