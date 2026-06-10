# GET /api/workspaces/{id}/messages

**Resource:** [workspaces](../resources/workspaces.md)
**List messages for a session within a workspace**
**Operation ID:** `get--api-workspaces-{id}-messages`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `session_id` | query | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Messages in chronological order |
| 404 | Workspace not found |

**Success Response Schema** (inline):

Array

## Security

- **bearerAuth**
