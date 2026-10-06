# GET /api/environments/{id}/tokens

**Resource:** [environments](../resources/environments.md)
**List active runner tokens (owner only)**
**Operation ID:** `get--api-environments-{id}-tokens`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Tokens |
| 404 | Not found or not owner |

**Success Response Schema** (inline):

Array

## Security

- **bearerAuth**
