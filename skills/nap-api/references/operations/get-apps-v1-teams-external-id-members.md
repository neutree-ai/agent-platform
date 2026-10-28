# GET /apps/v1/teams/{external_id}/members

**Resource:** [apps](../resources/apps.md)
**List the members of a team of the application**
**Operation ID:** `get--apps-v1-teams-{external_id}-members`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `external_id` | path | string | Yes | The application's own id for the team |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Members |
| 404 | Not found |

**Success Response Schema:**

Array of [AppUser](../schemas/App/AppUser.md)

## Security

- **appClientAuth**
