# POST /api/workspaces/{id}/sandboxes/{sandboxId}/renew

**Resource:** [workspaces](../resources/workspaces.md)
**Extend a sandbox expiry: adds extend_seconds to the current expiry, or to now if the sandbox has already expired.**
**Operation ID:** `post--api-workspaces-{id}-sandboxes-{sandboxId}-renew`

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
| `extend_seconds` | integer | No | Seconds to add (default 3600) |

## Responses

| Status | Description |
|--------|-------------|
| 200 | New expiry |
| 404 | Workspace or sandbox not found |
| 500 | Sandbox service error |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sandbox_id` | string | Yes |  |
| `expires_at` | string | Yes |  |

## Security

- **bearerAuth**
