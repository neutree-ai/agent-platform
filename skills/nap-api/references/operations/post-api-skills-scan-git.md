# POST /api/skills/scan-git

**Resource:** [skills](../resources/skills.md)
**List skill candidates in a git repo without persisting**
**Operation ID:** `post--api-skills-scan-git`

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

## Responses

| Status | Description |
|--------|-------------|
| 200 | Skill candidates |
| 400 | Invalid git URL |
| 404 | Credential not found |
| 502 | Upstream fetch failed |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `candidates` | object[] | Yes |  |
| `requested_subpath` | string,null | No |  |
| `commit_sha` | string,null | No |  |

**`candidates` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `subpath` | string | Yes |  |
| `name` | string,null | Yes |  |
| `description` | string,null | Yes |  |
| `fileCount` | number | Yes |  |
| `files` | object[] | Yes |  |
| `skillMd` | string,null | Yes |  |

## Security

- **bearerAuth**
