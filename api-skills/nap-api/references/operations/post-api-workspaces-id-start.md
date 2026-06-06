# POST /api/workspaces/{id}/start

**Resource:** [workspaces](../resources/workspaces.md)
**Start (or rebuild) a workspace instance**
**Operation ID:** `post--api-workspaces-{id}-start`

If the configured agent_type differs from the running container image, the deployment is rebuilt before starting.

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Start initiated |
| 404 | Workspace not found |
| 500 | Internal error |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | boolean | Yes |  |
| `rebuilt` | boolean | No |  |

## Security

- **bearerAuth**
