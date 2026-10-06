# POST /api/workspaces/{id}/rebuild

**Resource:** [workspaces](../resources/workspaces.md)
**Rebuild a workspace to the current platform template**
**Operation ID:** `post--api-workspaces-{id}-rebuild`

Recreates the workspace's Deployment when it drifts from the current desired spec (template version, agent image, sidecars), picking up platform updates. DISRUPTIVE: the pod is replaced, interrupting any in-flight session and clearing ephemeral (tmpfs) state. No-op when already in sync.

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Rebuild evaluated (rebuilt=false when already in sync) |
| 404 | Workspace not found |
| 500 | Internal error |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `rebuilt` | boolean | Yes |  |
| `reason` | string | No |  |

## Security

- **bearerAuth**
