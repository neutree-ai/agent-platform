# DELETE /api/providers/{id}

**Resource:** [providers](../resources/providers.md)
**Delete a model provider (owner only)**
**Operation ID:** `delete--api-providers-{id}`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Deleted |
| 403 | Forbidden |
| 404 | Provider not found |
| 409 | Provider is still referenced by one or more workspaces |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | boolean | Yes |  |

## Security

- **bearerAuth**
