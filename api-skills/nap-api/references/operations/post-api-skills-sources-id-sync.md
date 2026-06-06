# POST /api/skills/sources/{id}/sync

**Resource:** [skills](../resources/skills.md)
**Re-fetch a git source; create new versions for changed skills**
**Operation ID:** `post--api-skills-sources-{id}-sync`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `token` | string | No |  |
| `credential_name` | string | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Sync result (per-skill change flags) |
| 400 | Source is not a git source |
| 404 | Source not found |
| 502 | Upstream fetch failed |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `source` | object | Yes |  |
| `results` | object[] | Yes |  |
| `commit_sha` | string,null | Yes |  |

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

**`results` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `skill_id` | string | Yes |  |
| `version_id` | string | Yes |  |
| `content_hash` | string | Yes |  |
| `changed` | boolean | Yes |  |

## Security

- **bearerAuth**
