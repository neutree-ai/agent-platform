# PATCH /api/shares/{id}

**Resource:** [shares](../resources/shares.md)
**Update a share title (owner only)**
**Operation ID:** `patch--api-shares-{id}`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Updated |
| 404 | Share not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | boolean | Yes |  |

## Security

- **bearerAuth**
