# GET /api/workspaces/{id}/sandboxes

**Resource:** [workspaces](../resources/workspaces.md)
**List the sandboxes created for a workspace**
**Operation ID:** `get--api-workspaces-{id}-sandboxes`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Sandboxes |
| 404 | Workspace not found |
| 500 | Sandbox service error |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `items` | WorkspaceSandbox[] | Yes |  |

## Security

- **bearerAuth**
