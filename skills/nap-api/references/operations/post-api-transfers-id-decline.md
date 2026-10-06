# POST /api/transfers/{id}/decline

**Resource:** [transfers](../resources/transfers.md)
**Decline a transfer**
**Operation ID:** `post--api-transfers-{id}-decline`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Declined |
| 404 | Not found |
| 409 | Conflict |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | boolean | Yes |  |

## Security

- **bearerAuth**
