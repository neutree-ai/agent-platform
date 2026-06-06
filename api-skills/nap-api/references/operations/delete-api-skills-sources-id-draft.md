# DELETE /api/skills/sources/{id}/draft

**Resource:** [skills](../resources/skills.md)
**Discard the native source draft**
**Operation ID:** `delete--api-skills-sources-{id}-draft`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 204 | Discarded |
| 404 | Source not found |

## Security

- **bearerAuth**
