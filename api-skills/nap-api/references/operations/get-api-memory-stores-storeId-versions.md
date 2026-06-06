# GET /api/memory-stores/{storeId}/versions

**Resource:** [memory-stores](../resources/memory-stores.md)
**Operation ID:** `get--api-memory-stores-{storeId}-versions`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `storeId` | path | string | Yes |  |
| `path` | query | string | No |  |
| `limit` | query | integer | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | OK |
| 403 | Forbidden |
| 404 | Not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `versions` | object[] | Yes |  |

**`versions` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes |  |
| `store_id` | string | Yes |  |
| `memory_id` | string,null | Yes |  |
| `path` | string | Yes |  |
| `operation` | enum: create, update, delete... | Yes |  |
| `content_sha256` | string,null | Yes |  |
| `size_bytes` | integer,null | Yes |  |
| `actor_kind` | enum: user, agent, reflect... | Yes |  |
| `actor_id` | string,null | Yes |  |
| `created_at` | string | Yes |  |
| `version_number` | integer,null | Yes |  |

## Security

- **bearerAuth**
