# GET /api/skills/sources/{id}/skills

**Resource:** [skills](../resources/skills.md)
**List skills derived from this source**
**Operation ID:** `get--api-skills-sources-{id}-skills`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Skill list |
| 404 | Source not found |

**Success Response Schema** (inline):

Array

## Security

- **bearerAuth**
