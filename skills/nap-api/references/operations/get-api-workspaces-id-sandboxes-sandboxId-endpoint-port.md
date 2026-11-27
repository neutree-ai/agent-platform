# GET /api/workspaces/{id}/sandboxes/{sandboxId}/endpoint/{port}

**Resource:** [workspaces](../resources/workspaces.md)
**Get the preview URL of a port inside a sandbox. When `headers` is present, requests to the URL must carry them; when `expires_at` is present, the URL stops working then.**
**Operation ID:** `get--api-workspaces-{id}-sandboxes-{sandboxId}-endpoint-{port}`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `sandboxId` | path | string | Yes |  |
| `port` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Endpoint URL |
| 400 | Invalid port number, or the sandbox backend offers no previews |
| 404 | Workspace or sandbox not found |
| 500 | Sandbox service error |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sandbox_id` | string | Yes |  |
| `port` | number | Yes |  |
| `url` | string | Yes |  |
| `headers` | object | No |  |
| `expires_at` | string | No |  |

## Security

- **bearerAuth**
