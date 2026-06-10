# GET /api/prompts/{id}

**Resource:** [prompts](../resources/prompts.md)
**Get a prompt (visibility-aware)**
**Operation ID:** `get--api-prompts-{id}`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Prompt |
| 404 | Prompt not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes |  |
| `name` | string | Yes |  |
| `content` | string | Yes |  |
| `visibility` | enum: private, team, public | Yes |  |
| `is_public` | boolean | Yes |  |
| `current_version` | integer | Yes |  |
| `owner_name` | string | Yes |  |
| `is_own` | boolean | Yes |  |
| `my_permission` | enum: owner, editor, viewer... | Yes |  |
| `shared_via_teams` | object[] | Yes |  |
| `created_at` | string | Yes |  |
| `updated_at` | string | Yes |  |

**`shared_via_teams` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes |  |
| `name` | string | Yes |  |
| `permission` | enum: viewer, editor | Yes |  |

## Security

- **bearerAuth**
