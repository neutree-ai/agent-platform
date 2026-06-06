# GET /api/templates/{id}/grants

**Resource:** [templates](../resources/templates.md)
**List team grants for a template (owner only)**
**Operation ID:** `get--api-templates-{id}-grants`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Grant list |
| 404 | Template not found |

**Success Response Schema** (inline):

Array

## Security

- **bearerAuth**
