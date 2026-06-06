# PATCH /api/skills/sources/{id}

**Resource:** [skills](../resources/skills.md)
**Update source metadata (owner only)**
**Operation ID:** `patch--api-skills-sources-{id}`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `credential_name` | string,null | No |  |
| `git_ref` | string | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Updated source |
| 400 | Invalid input |
| 404 | Source not found |
| 502 | skills-content-service unavailable |

**Success Response Schema** (inline):

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

## Security

- **bearerAuth**
