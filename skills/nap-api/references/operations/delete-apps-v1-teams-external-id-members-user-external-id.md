# DELETE /apps/v1/teams/{external_id}/members/{user_external_id}

**Resource:** [apps](../resources/apps.md)
**Remove a user from a team of the application**
**Operation ID:** `delete--apps-v1-teams-{external_id}-members-{user_external_id}`

Folders the user shared with the team stop being shared with it, and folders the user mounted through the team are unmounted.

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `external_id` | path | string | Yes | The application's own id for the team |
| `user_external_id` | path | string | Yes | The application's own id for the user |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Removed |
| 404 | Not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | boolean | Yes |  |

## Security

- **appClientAuth**
