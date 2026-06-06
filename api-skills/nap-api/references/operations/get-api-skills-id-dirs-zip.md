# GET /api/skills/{id}/dirs/zip

**Resource:** [skills](../resources/skills.md)
**Download a directory inside a skill package as a zip archive**
**Operation ID:** `get--api-skills-{id}-dirs-zip`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `path` | query | string | No |  |
| `version` | query | string | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Zip archive |
| 404 | Skill or directory not found |
| 502 | Upstream unavailable |

## Security

- **bearerAuth**
