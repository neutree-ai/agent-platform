# POST /api/workspaces/{id}/commands

**Resource:** [workspaces](../resources/workspaces.md)
**Create a command. Either prompt_id or content must be provided.**
**Operation ID:** `post--api-workspaces-{id}-commands`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes |  |
| `type` | enum: plain, struct | No |  |
| `prompt_id` | string,null | No |  |
| `content` | string | No |  |
| `sort_order` | integer | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 201 | Created command |
| 400 | Invalid input |
| 404 | Workspace not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `command` | object | Yes |  |

**`command` fields:**

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
