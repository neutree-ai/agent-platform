# PUT /apps/v1/teams/{external_id}/members/{user_external_id}

**Resource:** [apps](../resources/apps.md)
**Add a user of the application to one of its teams**
**Operation ID:** `put--apps-v1-teams-{external_id}-members-{user_external_id}`

Idempotent. Provision the user first.

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `external_id` | path | string | Yes | The application's own id for the team |
| `user_external_id` | path | string | Yes | The application's own id for the user |

## Responses

| Status | Description |
|--------|-------------|
| 200 | The user is a member |
| 404 | Not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | boolean | Yes |  |

## Security

- **appClientAuth**
