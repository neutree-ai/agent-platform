# GET /api/workspaces/{id}/sandboxes/{sandboxId}/endpoint/{port}

**Resource:** [workspaces](../resources/workspaces.md)
**Get the URL of a port exposed by a sandbox**
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
| 400 | Invalid port number |
| 404 | Workspace not found |
| 500 | Sandbox service error |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sandbox_id` | string | Yes |  |
| `port` | number | Yes |  |
| `url` | string | Yes |  |

## Security

- **bearerAuth**
