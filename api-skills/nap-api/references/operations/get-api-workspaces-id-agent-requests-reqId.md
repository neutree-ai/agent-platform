# GET /api/workspaces/{id}/agent-requests/{reqId}

**Resource:** [workspaces](../resources/workspaces.md)
**Read a single agent_request for human-in-loop review.**
**Operation ID:** `get--api-workspaces-{id}-agent-requests-{reqId}`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `reqId` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Request |
| 404 | Not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes |  |
| `workspace_id` | string | Yes |  |
| `user_id` | string | Yes |  |
| `kind` | string | Yes |  |
| `payload` | object | Yes |  |
| `status` | enum: pending, approved, rejected... | Yes |  |
| `reject_reason` | string,null | Yes |  |
| `created_at` | string | Yes |  |
| `resolved_at` | string,null | Yes |  |
| `applied_at` | string,null | No |  |

## Security

- **bearerAuth**
