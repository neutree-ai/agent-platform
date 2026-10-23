# DELETE /apps/v1/users/{external_id}/agents/{agent}

**Resource:** [apps](../resources/apps.md)
**Delete the user's workspace for an agent**
**Operation ID:** `delete--apps-v1-users-{external_id}-agents-{agent}`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `external_id` | path | string | Yes | The application's own id for the user |
| `agent` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Deleted |
| 404 | Not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | boolean | Yes |  |

## Security

- **appClientAuth**
