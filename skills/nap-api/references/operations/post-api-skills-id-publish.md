# POST /api/skills/{id}/publish

**Resource:** [skills](../resources/skills.md)
**Publish the native draft as a new active version**
**Operation ID:** `post--api-skills-{id}-publish`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `note` | string | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Published |
| 400 | No draft or invalid |
| 404 | Skill not found |
| 502 | skills-content-service unavailable |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `skill` | object | Yes |  |
| `version` | object | Yes |  |

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

**`version` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes |  |
| `skill_id` | string | Yes |  |
| `source_id` | string | Yes |  |
| `content_hash` | string | Yes |  |
| `commit_sha` | string,null | Yes |  |
| `note` | string,null | Yes |  |
| `published_at` | string | Yes |  |
| `published_by` | string | Yes |  |

## Security

- **bearerAuth**
