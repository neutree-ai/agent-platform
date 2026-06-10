# GET /api/providers/{id}/grants

**Resource:** [providers](../resources/providers.md)
**List team grants for a provider (owner only)**
**Operation ID:** `get--api-providers-{id}-grants`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Grant list |
| 404 | Provider not found |

**Success Response Schema** (inline):

Array

## Security

- **bearerAuth**
