# POST /api/workspaces/{id}/sandboxes/{sandboxId}/files

**Resource:** [workspaces](../resources/workspaces.md)
**Write files inside a sandbox. Parent directories are created automatically.**
**Operation ID:** `post--api-workspaces-{id}-sandboxes-{sandboxId}-files`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `sandboxId` | path | string | Yes |  |

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `files` | object[] | Yes |  |

**`files` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | string | Yes | Absolute path inside the sandbox |
| `content` | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Written |
| 404 | Workspace or sandbox not found |
| 500 | Sandbox service error |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | boolean | Yes |  |

## Security

- **bearerAuth**
