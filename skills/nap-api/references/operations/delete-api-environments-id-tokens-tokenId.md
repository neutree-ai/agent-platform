# DELETE /api/environments/{id}/tokens/{tokenId}

**Resource:** [environments](../resources/environments.md)
**Revoke a runner token (owner only)**
**Operation ID:** `delete--api-environments-{id}-tokens-{tokenId}`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `tokenId` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Revoked |
| 404 | Not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | boolean | Yes |  |

## Security

- **bearerAuth**
