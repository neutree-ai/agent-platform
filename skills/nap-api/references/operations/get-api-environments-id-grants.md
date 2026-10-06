# GET /api/environments/{id}/grants

**Resource:** [environments](../resources/environments.md)
**List team grants (owner only)**
**Operation ID:** `get--api-environments-{id}-grants`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Grants |
| 404 | Not found or not owner |

**Success Response Schema** (inline):

Array

## Security

- **bearerAuth**
