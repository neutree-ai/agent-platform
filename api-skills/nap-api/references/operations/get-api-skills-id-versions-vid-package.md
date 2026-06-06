# GET /api/skills/{id}/versions/{vid}/package

**Resource:** [skills](../resources/skills.md)
**Download one historical version package**
**Operation ID:** `get--api-skills-{id}-versions-{vid}-package`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `vid` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Version package |
| 404 | Skill or version not found |

## Security

- **bearerAuth**
