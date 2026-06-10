# GET /api/skills/{id}

**Resource:** [skills](../resources/skills.md)
**Read one skill by id (visibility-gated)**
**Operation ID:** `get--api-skills-{id}`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Skill |
| 404 | Skill not found |

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
