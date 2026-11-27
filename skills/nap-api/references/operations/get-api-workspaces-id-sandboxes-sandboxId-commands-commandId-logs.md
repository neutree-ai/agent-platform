# GET /api/workspaces/{id}/sandboxes/{sandboxId}/commands/{commandId}/logs

**Resource:** [workspaces](../resources/workspaces.md)
**Get output of a background command as { content, cursor }. When cursor is present, pass it back to read only newer output; without it, each call returns the whole log.**
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
| 400 | Not supported by the sandbox backend, or invalid input |
| 404 | Workspace or sandbox not found |
| 500 | Sandbox service error |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `content` | string | Yes |  |
| `cursor` | number | No |  |

## Security

- **bearerAuth**
