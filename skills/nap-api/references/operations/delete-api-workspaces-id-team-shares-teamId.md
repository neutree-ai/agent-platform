# DELETE /api/workspaces/{id}/team-shares/{teamId}

**Resource:** [workspaces](../resources/workspaces.md)
**Stop sharing a workspace with a team (owner only). Takes effect immediately.**
**Operation ID:** `delete--api-workspaces-{id}-team-shares-{teamId}`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `teamId` | path | string | Yes |  |

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
