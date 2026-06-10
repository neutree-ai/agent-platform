# GET /api/skills/{id}/versions

**Resource:** [skills](../resources/skills.md)
**List published versions for a skill (newest first)**
**Operation ID:** `get--api-skills-{id}-versions`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Version list |
| 404 | Skill not found |

**Success Response Schema** (inline):

Array

## Security

- **bearerAuth**
