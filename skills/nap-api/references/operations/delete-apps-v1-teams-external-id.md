# DELETE /apps/v1/teams/{external_id}

**Resource:** [apps](../resources/apps.md)
**Delete a team of the application**
**Operation ID:** `delete--apps-v1-teams-{external_id}`

Folders shared with the team stop being mounted through it.

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `external_id` | path | string | Yes | The application's own id for the team |

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
