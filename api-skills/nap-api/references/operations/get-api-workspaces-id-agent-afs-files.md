# GET /api/workspaces/{id}/agent/afs-files

**Resource:** [agent-afs-files](../resources/agent-afs-files.md)
**Read a file from the AgentFS shared mounts (/mnt/afs)**
**Operation ID:** `get--api-workspaces-{id}-agent-afs-files`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `path` | query | string | Yes | Path inside the workspace filesystem. May contain slashes. |

## Responses

| Status | Description |
|--------|-------------|
| 200 | File contents |
| 404 | Workspace or file not found |
| 502 | Agent unavailable |
| 503 | Workspace not running |

## Security

- **bearerAuth**
