# DELETE /api/skills/sources/{id}

**Resource:** [skills](../resources/skills.md)
**Delete a source (owner only); fails if any skill still under it**
**Operation ID:** `delete--api-skills-sources-{id}`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 204 | Deleted |
| 404 | Source not found |
| 409 | Source still has skills |

## Security

- **bearerAuth**
