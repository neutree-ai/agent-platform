# POST /api/memory-stores

**Resource:** [memory-stores](../resources/memory-stores.md)
**Create a memory store**
**Operation ID:** `post--api-memory-stores`

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes |  |
| `description` | string | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 201 | Created |

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
