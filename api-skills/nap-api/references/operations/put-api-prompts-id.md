# PUT /api/prompts/{id}

**Resource:** [prompts](../resources/prompts.md)
**Update a prompt. Owner can change anything; editors can change name/content. Reloads running workspaces.**
**Operation ID:** `put--api-prompts-{id}`

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
| `content` | string | No |  |
| `visibility` | enum: private, team, public | No |  |
| `grants` | object[] | No |  |

**`grants` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `team_id` | string | Yes |  |
| `permission` | enum: viewer, editor | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Updated prompt |
| 400 | Invalid grants for visibility |
| 403 | Not allowed to update this prompt |
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
