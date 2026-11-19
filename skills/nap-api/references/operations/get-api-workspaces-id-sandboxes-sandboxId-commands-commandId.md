# GET /api/workspaces/{id}/sandboxes/{sandboxId}/commands/{commandId}

**Resource:** [workspaces](../resources/workspaces.md)
**Get the status of a background command (running, exit_code, timing)**
**Operation ID:** `get--api-workspaces-{id}-sandboxes-{sandboxId}-commands-{commandId}`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `sandboxId` | path | string | Yes |  |
| `commandId` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Command status |
| 404 | Workspace or sandbox not found |
| 500 | Sandbox service error |

## Security

- **bearerAuth**
