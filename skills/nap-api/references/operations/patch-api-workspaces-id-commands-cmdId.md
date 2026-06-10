# PATCH /api/workspaces/{id}/commands/{cmdId}

**Resource:** [workspaces](../resources/workspaces.md)
**Update a command**
**Operation ID:** `patch--api-workspaces-{id}-commands-{cmdId}`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `cmdId` | path | string | Yes |  |

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | No |  |
| `type` | enum: plain, struct | No |  |
| `prompt_id` | string,null | No |  |
| `content` | string | No |  |
| `sort_order` | integer | No |  |
| `disabled` | boolean | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Updated command |
| 404 | Workspace or command not found |

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
