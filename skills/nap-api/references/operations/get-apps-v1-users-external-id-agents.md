# GET /apps/v1/users/{external_id}/agents

**Resource:** [apps](../resources/apps.md)
**List the user's agent workspaces**
**Operation ID:** `get--apps-v1-users-{external_id}-agents`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `external_id` | path | string | Yes | The application's own id for the user |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Workspaces |
| 404 | Not found |

**Success Response Schema:**

Array of [AppAgentWorkspace](../schemas/App/AppAgentWorkspace.md)

## Security

- **appClientAuth**
