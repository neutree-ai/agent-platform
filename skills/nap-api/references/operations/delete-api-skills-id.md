# DELETE /api/skills/{id}

**Resource:** [skills](../resources/skills.md)
**Delete a skill (owner only). Fails if still attached anywhere.**
**Operation ID:** `delete--api-skills-{id}`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 204 | Deleted |
| 403 | Not allowed |
| 404 | Skill not found |
| 409 | Still in use |

## Security

- **bearerAuth**
