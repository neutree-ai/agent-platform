# POST /api/workspaces/{id}/sandboxes

**Resource:** [workspaces](../resources/workspaces.md)
**Create a sandbox for a workspace. It runs as the workspace owner.**
**Operation ID:** `post--api-workspaces-{id}-sandboxes`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `image` | string | Yes |  |
| `resource` | object | No | Resource limits, e.g. { "cpu": "2", "memory": "4Gi" } |
| `timeout_seconds` | integer | No | Lifetime in seconds from now (default 3600) |
| `env` | object | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 201 | Created sandbox |
| 404 | Workspace not found |
| 500 | Sandbox service error |

**Success Response Schema:**

[WorkspaceSandbox](../schemas/Workspace/WorkspaceSandbox.md)

## Security

- **bearerAuth**
