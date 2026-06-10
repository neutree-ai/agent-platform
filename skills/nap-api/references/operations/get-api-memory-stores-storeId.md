# GET /api/memory-stores/{storeId}

**Resource:** [memory-stores](../resources/memory-stores.md)
**Operation ID:** `get--api-memory-stores-{storeId}`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `storeId` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | OK |
| 403 | Forbidden |
| 404 | Not found |

**Success Response Schema** (inline):

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
