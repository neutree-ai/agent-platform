# PATCH /api/skills/{id}

**Resource:** [skills](../resources/skills.md)
**Update skill metadata. Owner: anything. Editor: description only.**
**Operation ID:** `patch--api-skills-{id}`

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
| `description` | string | No |  |
| `visibility` | enum: private, team, public | No |  |
| `grants` | object[] | No |  |
| `category` | string,null | No |  |

**`grants` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `team_id` | string | Yes |  |
| `permission` | enum: viewer, editor | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Updated skill |
| 400 | Invalid input |
| 403 | Not allowed |
| 404 | Skill not found |
| 409 | Cannot unpublish while other users still reference it |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes |  |
| `source_id` | string | Yes |  |
| `source_kind` | enum: git, native | Yes |  |
| `active_version_id` | string,null | Yes |  |
| `name` | string | Yes |  |
| `subpath` | string | Yes |  |
| `description` | string | Yes |  |
| `user_id` | string | Yes |  |
| `is_public` | boolean | Yes |  |
| `visibility` | enum: private, team, public | Yes |  |
| `my_permission` | enum: owner, editor, viewer... | Yes |  |
| `shared_via_teams` | object[] | Yes |  |
| `owner_name` | string | Yes |  |
| `is_own` | boolean | Yes |  |
| `category` | string,null | Yes |  |
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
