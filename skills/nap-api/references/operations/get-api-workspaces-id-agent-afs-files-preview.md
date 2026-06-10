# GET /api/workspaces/{id}/agent/afs-files/preview

**Resource:** [agent-afs-files](../resources/agent-afs-files.md)
**Render an Office document (pptx/docx/xlsx/…) to PDF**
**Operation ID:** `get--api-workspaces-{id}-agent-afs-files-preview`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `path` | query | string | Yes | Path inside the workspace filesystem. May contain slashes. |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Rendered PDF |
| 404 | Workspace or file not found |
| 415 | File type not supported for preview |
| 501 | Office converter not configured |
| 502 | Agent or converter unavailable |
| 503 | Workspace not running |

## Security

- **bearerAuth**
