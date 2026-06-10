# GET /api/memory-stores/{storeId}/memories

**Resource:** [memory-stores](../resources/memory-stores.md)
**Operation ID:** `get--api-memory-stores-{storeId}-memories`

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
| `memories` | object[] | Yes |  |

**`memories` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes |  |
| `store_id` | string | Yes |  |
| `path` | string | Yes |  |
| `content_sha256` | string | Yes |  |
| `size_bytes` | integer | Yes |  |
| `description` | string | Yes |  |
| `mem_type` | string,null | Yes |  |
| `created_at` | string | Yes |  |
| `updated_at` | string | Yes |  |

## Security

- **bearerAuth**
