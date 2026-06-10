# DELETE /api/memory-stores/{storeId}

**Resource:** [memory-stores](../resources/memory-stores.md)
**Operation ID:** `delete--api-memory-stores-{storeId}`

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
| 409 | Conflict — store still attached to one or more workspaces |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | boolean | Yes |  |

## Security

- **bearerAuth**
