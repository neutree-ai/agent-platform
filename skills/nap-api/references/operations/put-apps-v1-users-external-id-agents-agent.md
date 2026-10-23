# PUT /apps/v1/users/{external_id}/agents/{agent}

**Resource:** [apps](../resources/apps.md)
**Ensure the user's workspace for an agent**
**Operation ID:** `put--apps-v1-users-{external_id}-agents-{agent}`

Idempotent. Creates the workspace from the agent's template on the first call; afterwards returns it, bringing it up to date first when it is behind and idle. Either way, the user's shared folders are brought in line with the workspaces it has. Call the API as the user (see the token route) to chat with it.

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `external_id` | path | string | Yes | The application's own id for the user |
| `agent` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | The workspace existed |
| 201 | The workspace was created |
| 404 | No such user, or no such agent in the spec |
| 409 | No environment the user can use fits the agent |

**Success Response Schema:**

[AppAgentWorkspace](../schemas/App/AppAgentWorkspace.md)

## Security

- **appClientAuth**
