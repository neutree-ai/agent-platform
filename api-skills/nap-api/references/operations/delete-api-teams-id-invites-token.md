# DELETE /api/teams/{id}/invites/{token}

**Resource:** [teams](../resources/teams.md)
**Revoke an invite link (admin only)**
**Operation ID:** `delete--api-teams-{id}-invites-{token}`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `token` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Revoked |
| 403 | Forbidden |
| 404 | Not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | boolean | Yes |  |

## Security

- **bearerAuth**
