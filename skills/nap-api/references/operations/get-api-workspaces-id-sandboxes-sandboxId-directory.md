# GET /api/workspaces/{id}/sandboxes/{sandboxId}/directory

**Resource:** [workspaces](../resources/workspaces.md)
**List a directory inside a sandbox**
**Operation ID:** `get--api-workspaces-{id}-sandboxes-{sandboxId}-directory`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `sandboxId` | path | string | Yes |  |
| `path` | query | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Directory entries |
| 400 | Not supported by the sandbox backend, or invalid input |
| 404 | Workspace or sandbox not found |
| 500 | Sandbox service error |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `files` | object[] | Yes |  |

**`files` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | string | Yes |  |
| `type` | string | No |  |
| `size` | number | No |  |
| `modified_at` | string | No |  |

## Security

- **bearerAuth**
