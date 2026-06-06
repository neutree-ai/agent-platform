# POST /api/skills/from-git

**Resource:** [skills](../resources/skills.md)
**Import a single subpath from a git repo as a new skill**
**Operation ID:** `post--api-skills-from-git`

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
| `name` | string | No |  |
| `description` | string | No |  |
| `visibility` | enum: private, team, public | No |  |
| `category` | string,null | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 201 | New skill created |
| 400 | Invalid input — or repo had multiple skill candidates and no subpath was specified (response includes `candidates`) |
| 404 | Credential not found |
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
