# GET /api/skills/{id}/files

**Resource:** [skills](../resources/skills.md)
**Read a file from the skill package (visibility-gated)**
**Operation ID:** `get--api-skills-{id}-files`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `path` | query | string | No |  |
| `version` | query | string | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | File contents |
| 404 | Skill or file not found |
| 502 | Upstream unavailable |

## Security

- **bearerAuth**
