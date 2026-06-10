# PUT /api/workspaces/{id}/agent/afs-files

**Resource:** [agent-afs-files](../resources/agent-afs-files.md)
**Write (create or overwrite) a file**
**Operation ID:** `put--api-workspaces-{id}-agent-afs-files`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `path` | query | string | Yes | Path inside the workspace filesystem. May contain slashes. |

## Request Body

File contents

**Content Types:** `application/octet-stream`

## Responses

| Status | Description |
|--------|-------------|
| 200 | File written |
| 404 | Workspace not found |
| 502 | Agent unavailable |
| 503 | Workspace not running |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | boolean | Yes |  |

## Security

- **bearerAuth**
