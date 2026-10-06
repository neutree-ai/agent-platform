# POST /api/skills/{id}/switch-to-git

**Resource:** [skills](../resources/skills.md)
**Switch a native skill to a git source in place (wipes native history)**
**Operation ID:** `post--api-skills-{id}-switch-to-git`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | Yes |  |
| `type` | string | No |  |
| `ref` | string | No |  |
| `token` | string | No |  |
| `credential_name` | string | No |  |
| `subpath` | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Skill switched to git source |
| 400 | Invalid input — bad repo / subpath / no SKILL.md |
| 404 | Skill or credential not found |
| 409 | Skill is not native, or subpath is taken by another skill |
| 502 | Upstream fetch failed |

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
