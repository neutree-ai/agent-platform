# GET /api/templates/{id}/versions

**Resource:** [templates](../resources/templates.md)
**List versions of a template**
**Operation ID:** `get--api-templates-{id}-versions`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Version list |
| 404 | Template not found |

**Success Response Schema** (inline):

Array

## Security

- **bearerAuth**
