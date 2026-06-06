# POST /api/prompts/{id}/rollback

**Resource:** [prompts](../resources/prompts.md)
**Roll back to an earlier version (owner or editor)**
**Operation ID:** `post--api-prompts-{id}-rollback`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | integer | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Updated prompt |
| 403 | Not allowed |
| 404 | Prompt or version not found |

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
