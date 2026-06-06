# GET /api/skills/sources/{id}

**Resource:** [skills](../resources/skills.md)
**Read one source by id**
**Operation ID:** `get--api-skills-sources-{id}`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Source |
| 404 | Source not found |

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
