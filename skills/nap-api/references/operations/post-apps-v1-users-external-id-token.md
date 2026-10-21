# POST /apps/v1/users/{external_id}/token

**Resource:** [apps](../resources/apps.md)
**Obtain a short-lived access token for a user of the application**
**Operation ID:** `post--apps-v1-users-{external_id}-token`

Pass it as `Authorization: Bearer <token>` to call the API as that user. Request a new one when it expires; there is no refresh token.

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `external_id` | path | string | Yes | The application's own id for the user |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Access token |
| 404 | Not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `access_token` | string | Yes |  |
| `token_type` | enum: Bearer | Yes |  |
| `expires_in` | number | Yes | Lifetime in seconds |

## Security

- **appClientAuth**
