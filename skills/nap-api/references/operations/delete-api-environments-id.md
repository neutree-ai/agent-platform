# DELETE /api/environments/{id}

**Resource:** [environments](../resources/environments.md)
**Delete a remote environment (owner only)**
**Operation ID:** `delete--api-environments-{id}`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Deleted |
| 404 | Not found or not owner |
| 409 | Environment still has workspaces |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | boolean | Yes |  |

## Security

- **bearerAuth**
