# POST /api/workspaces/{id}/agent/afs-dirs

**Resource:** [agent-afs-files](../resources/agent-afs-files.md)
**Create a directory**
**Operation ID:** `post--api-workspaces-{id}-agent-afs-dirs`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 201 | Directory created |
| 404 | Workspace not found |
| 409 | Directory already exists |
| 502 | Agent unavailable |
| 503 | Workspace not running |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | boolean | Yes |  |

## Security

- **bearerAuth**
