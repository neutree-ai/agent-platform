# PATCH /api/workspaces/{id}

**Resource:** [workspaces](../resources/workspaces.md)
**Rename a workspace or change its slug / visibility**
**Operation ID:** `patch--api-workspaces-{id}`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | No |  |
| `slug` | string,null | No |  |
| `visibility` | enum: private, user, public | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Updated workspace |
| 400 | Invalid input |
| 404 | Workspace not found |
| 409 | Slug already in use |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes |  |
| `name` | string | Yes |  |
| `slug` | string,null | Yes |  |
| `visibility` | string | Yes |  |
| `is_system` | boolean | Yes |  |
| `owner` | string | Yes |  |
| `status` | string | Yes |  |
| `created_at` | string | Yes |  |
| `tag_ids` | string[] | Yes |  |
| `active_agent_sessions` | integer | Yes |  |
| `active_human_sessions` | integer | Yes |  |
| `active_sessions` | object[] | Yes |  |

**`active_sessions` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes |  |
| `chat_status` | string | Yes |  |
| `preview` | string | Yes |  |
| `name` | string | No |  |

## Security

- **bearerAuth**
