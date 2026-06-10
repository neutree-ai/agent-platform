# GET /api/teams/{id}/invites

**Resource:** [teams](../resources/teams.md)
**List active (non-expired) invite links for a team (admin only)**
**Operation ID:** `get--api-teams-{id}-invites`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Invites |
| 403 | Forbidden |
| 404 | Not found |

**Success Response Schema** (inline):

Array

## Security

- **bearerAuth**
