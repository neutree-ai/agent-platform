# POST /api/workspaces/{id}/sandboxes/{sandboxId}/commands/{commandId}/interrupt

**Resource:** [workspaces](../resources/workspaces.md)
**Interrupt a running background command**
**Operation ID:** `post--api-workspaces-{id}-sandboxes-{sandboxId}-commands-{commandId}-interrupt`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `sandboxId` | path | string | Yes |  |
| `commandId` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Interrupted |
| 404 | Workspace or sandbox not found |
| 500 | Sandbox service error |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | boolean | Yes |  |

## Security

- **bearerAuth**
