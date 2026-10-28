# PUT /apps/v1/teams/{external_id}

**Resource:** [apps](../resources/apps.md)
**Create a team of the application, or update its name and description**
**Operation ID:** `put--apps-v1-teams-{external_id}`

Idempotent. The team starts with no members.

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `external_id` | path | string | Yes | The application's own id for the team |

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes |  |
| `description` | string,null | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | The team already existed and was updated |
| 201 | The team was created |

**Success Response Schema:**

[AppTeam](../schemas/App/AppTeam.md)

## Security

- **appClientAuth**
