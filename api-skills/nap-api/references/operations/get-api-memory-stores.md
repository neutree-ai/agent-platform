# GET /api/memory-stores

**Resource:** [memory-stores](../resources/memory-stores.md)
**List memory stores owned by the current user**
**Operation ID:** `get--api-memory-stores`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `include_archived` | query | boolean,null | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | OK |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `stores` | object[] | Yes |  |

**`stores` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes |  |
| `owner_user_id` | string | Yes |  |
| `name` | string | Yes |  |
| `description` | string | Yes |  |
| `archived_at` | string,null | Yes |  |
| `created_at` | string | Yes |  |
| `updated_at` | string | Yes |  |
| `memory_count` | integer | Yes |  |

## Security

- **bearerAuth**
