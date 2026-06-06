# POST /api/skills/sources/native

**Resource:** [skills](../resources/skills.md)
**Create a native (in-NAP authored) source + initial empty skill**
**Operation ID:** `post--api-skills-sources-native`

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes |  |
| `description` | string | Yes |  |
| `visibility` | enum: private, team, public | Yes |  |
| `category` | string,null | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 201 | Source + skill created |
| 400 | Invalid input |
| 502 | skills-content-service unavailable |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `source` | object | Yes |  |
| `skill` | object | Yes |  |

**`source` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes |  |
| `user_id` | string | Yes |  |
| `kind` | enum: git, native | Yes |  |
| `git_type` | string,null | Yes |  |
| `git_url` | string,null | Yes |  |
| `git_host` | string,null | Yes |  |
| `git_owner` | string,null | Yes |  |
| `git_repo` | string,null | Yes |  |
| `git_ref` | string,null | Yes |  |
| `credential_name` | string,null | Yes |  |
| `last_commit_sha` | string,null | Yes |  |
| `last_synced_at` | string,null | Yes |  |
| `has_draft` | boolean | Yes |  |
| `skill_count` | number | Yes |  |
| `created_at` | string | Yes |  |
| `updated_at` | string | Yes |  |

**`skill` fields:**

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

## Security

- **bearerAuth**
