# POST /api/workspaces/{id}/agent/afs-move

**Resource:** [agent-afs-files](../resources/agent-afs-files.md)
**Move or rename a file or directory**
**Operation ID:** `post--api-workspaces-{id}-agent-afs-move`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `src` | string | Yes |  |
| `dest` | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Moved |
| 404 | Workspace or source not found |
| 502 | Agent unavailable |
| 503 | Workspace not running |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | boolean | Yes |  |

## Security

- **bearerAuth**
