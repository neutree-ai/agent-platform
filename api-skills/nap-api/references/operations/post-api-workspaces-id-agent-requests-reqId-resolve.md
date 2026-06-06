# POST /api/workspaces/{id}/agent-requests/{reqId}/resolve

**Resource:** [workspaces](../resources/workspaces.md)
**Approve or reject a pending agent_request.**
**Operation ID:** `post--api-workspaces-{id}-agent-requests-{reqId}-resolve`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `reqId` | path | string | Yes |  |

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `decision` | enum: approved, rejected | Yes |  |
| `reason` | string | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Resolved |
| 404 | Not found |
| 409 | Already resolved |

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
