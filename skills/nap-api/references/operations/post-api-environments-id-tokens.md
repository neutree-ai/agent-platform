# POST /api/environments/{id}/tokens

**Resource:** [environments](../resources/environments.md)
**Issue a runner token for an environment (owner only)**
**Operation ID:** `post--api-environments-{id}-tokens`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 201 | Created token (plaintext shown once) |
| 404 | Not found or not owner |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes |  |
| `token` | string | Yes |  |
| `created_at` | string | Yes |  |

## Security

- **bearerAuth**
