# POST /api/transfers/{id}/accept

**Resource:** [transfers](../resources/transfers.md)
**Accept a transfer; the workspace becomes the caller’s**
**Operation ID:** `post--api-transfers-{id}-accept`

Runs the transfer. `slug` is required when the caller already has a workspace with the same slug; `provider_id` when the caller cannot use the workspace’s provider. A failed attempt leaves the transfer pending.

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `slug` | string | No |  |
| `provider_id` | string | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Transferred |
| 400 | Invalid request |
| 404 | Not found |
| 409 | Conflict |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes |  |
| `workspace_id` | string | Yes |  |
| `workspace_name` | string | Yes |  |
| `from_user` | object | Yes |  |
| `to_user` | object | Yes |  |
| `initiated_by` | string | Yes |  |
| `status` | enum: pending, executing, completed... | Yes |  |
| `copy` | object | Yes |  |
| `error` | string,null | Yes |  |
| `created_at` | string | Yes |  |
| `expires_at` | string | Yes |  |
| `resolved_at` | string,null | Yes |  |

**`from_user` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes |  |
| `username` | string | Yes |  |
| `display_name` | string | Yes |  |

**`to_user` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes |  |
| `username` | string | Yes |  |
| `display_name` | string | Yes |  |

**`copy` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `prompts` | string[] | Yes |  |
| `skills` | string[] | Yes |  |

## Security

- **bearerAuth**
