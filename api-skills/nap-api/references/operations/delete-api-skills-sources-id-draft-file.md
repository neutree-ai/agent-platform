# DELETE /api/skills/sources/{id}/draft/file

**Resource:** [skills](../resources/skills.md)
**Delete a single draft file**
**Operation ID:** `delete--api-skills-sources-{id}-draft-file`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `path` | query | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 204 | Deleted |
| 404 | Not found |

## Security

- **bearerAuth**
