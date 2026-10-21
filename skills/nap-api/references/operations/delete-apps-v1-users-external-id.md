# DELETE /apps/v1/users/{external_id}

**Resource:** [apps](../resources/apps.md)
**Delete a user of the application**
**Operation ID:** `delete--apps-v1-users-{external_id}`

Delete the user's workspaces first; a user that still owns any is refused.

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `external_id` | path | string | Yes | The application's own id for the user |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Deleted |
| 404 | Not found |
| 409 | The user still owns resources |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | boolean | Yes |  |

## Security

- **appClientAuth**
