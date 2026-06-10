# GET /api/skills/{id}/package

**Resource:** [skills](../resources/skills.md)
**Download the skill's active-version tar.gz package**
**Operation ID:** `get--api-skills-{id}-package`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Skill package |
| 404 | Skill not found |

## Security

- **bearerAuth**
