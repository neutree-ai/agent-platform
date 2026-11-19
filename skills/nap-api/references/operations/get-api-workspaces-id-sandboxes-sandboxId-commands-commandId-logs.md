# GET /api/workspaces/{id}/sandboxes/{sandboxId}/commands/{commandId}/logs

**Resource:** [workspaces](../resources/workspaces.md)
**Get output of a background command as { content, cursor }. Pass the returned cursor back to read only newer output.**
**Operation ID:** `get--api-workspaces-{id}-sandboxes-{sandboxId}-commands-{commandId}-logs`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `sandboxId` | path | string | Yes |  |
| `commandId` | path | string | Yes |  |
| `cursor` | query | integer,null | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Command logs |
| 404 | Workspace or sandbox not found |
| 500 | Sandbox service error |

## Security

- **bearerAuth**
