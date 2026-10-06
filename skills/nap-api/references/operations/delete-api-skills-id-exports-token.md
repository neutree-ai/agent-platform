# DELETE /api/skills/{id}/exports/{token}

**Resource:** [skills](../resources/skills.md)
**Revoke a public share (owner only)**
**Operation ID:** `delete--api-skills-{id}-exports-{token}`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `token` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 204 | Revoked |
| 404 | Skill or share not found |

## Security

- **bearerAuth**
