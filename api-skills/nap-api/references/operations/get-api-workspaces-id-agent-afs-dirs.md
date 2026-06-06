# GET /api/workspaces/{id}/agent/afs-dirs

**Resource:** [agent-afs-files](../resources/agent-afs-files.md)
**List directory entries**
**Operation ID:** `get--api-workspaces-{id}-agent-afs-dirs`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `path` | query | string | Yes | Path inside the workspace filesystem. May contain slashes. |
| `q` | query | string | No | Optional substring search within the directory. |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Directory entries |
| 404 | Workspace or directory not found |
| 502 | Agent unavailable |
| 503 | Workspace not running |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `entries` | object[] | Yes |  |

**`entries` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes |  |
| `path_type` | enum: Dir, File, SymLink... | Yes |  |
| `mtime` | number | Yes |  |
| `size` | number | Yes |  |

## Security

- **bearerAuth**
