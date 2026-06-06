# GET /api/skills/{id}/grants

**Resource:** [skills](../resources/skills.md)
**List team grants for a skill (owner only)**
**Operation ID:** `get--api-skills-{id}-grants`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Grant list |
| 404 | Skill not found |

**Success Response Schema** (inline):

Array

## Security

- **bearerAuth**
