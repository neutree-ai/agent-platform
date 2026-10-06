# GET /api/skills/{id}/exports

**Resource:** [skills](../resources/skills.md)
**List active public shares for a skill (owner only)**
**Operation ID:** `get--api-skills-{id}-exports`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Share list |
| 404 | Skill not found |

**Success Response Schema** (inline):

Array

## Security

- **bearerAuth**
