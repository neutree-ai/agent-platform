# POST /api/skills/scan-tarball

**Resource:** [skills](../resources/skills.md)
**List skill candidates inside an uploaded tarball without persisting**
**Operation ID:** `post--api-skills-scan-tarball`

## Responses

| Status | Description |
|--------|-------------|
| 200 | Skill candidates |
| 400 | Empty body or invalid tarball |
| 413 | Body exceeds size limit |
| 502 | skills-content-service unavailable |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `candidates` | object[] | Yes |  |

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
