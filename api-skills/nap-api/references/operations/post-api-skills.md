# POST /api/skills

**Resource:** [skills](../resources/skills.md)
**Upload a skill package (tar.gz). Metadata goes in query params.**
**Operation ID:** `post--api-skills`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `name` | query | string | Yes |  |
| `description` | query | string | No |  |
| `visibility` | query | enum: private, team, public | No |  |
| `category` | query | string | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 201 | New skill created |
| 400 | Empty body |
| 413 | Package exceeds size limit |
| 502 | skills-content-service unavailable |

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
