# DELETE /api/teams/{id}/members/{userId}

**Resource:** [teams](../resources/teams.md)
**Remove a member. Admins can remove anyone; users can remove themselves.**
**Operation ID:** `delete--api-teams-{id}-members-{userId}`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `userId` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Removed |
| 403 | Forbidden |
| 404 | Not found |
| 409 | Conflict |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | boolean | Yes |  |

## Security

- **bearerAuth**
