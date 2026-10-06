# GET /api/transfers/{id}

**Resource:** [transfers](../resources/transfers.md)
**A transfer, with its plan while it is pending**
**Operation ID:** `get--api-transfers-{id}`

Visible to its sender and recipient. The plan is recomputed from live state, so it shows what accepting would do now.

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Transfer |
| 404 | Not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `transfer` | object | Yes |  |
| `plan` | object,null | Yes |  |

**`transfer` fields:**

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

## Security

- **bearerAuth**
