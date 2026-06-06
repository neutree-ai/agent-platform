# GET /api/workspaces/{id}/agent/dirs/zip

**Resource:** [agent-files](../resources/agent-files.md)
**Download a directory as a zip archive**
**Operation ID:** `get--api-workspaces-{id}-agent-dirs-zip`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `path` | query | string | Yes | Path inside the workspace filesystem. May contain slashes. |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Zip archive |
| 404 | Workspace not found |
| 502 | Agent unavailable |
| 503 | Workspace not running |

## Security

- **bearerAuth**
