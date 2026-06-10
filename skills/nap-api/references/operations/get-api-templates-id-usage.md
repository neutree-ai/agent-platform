# GET /api/templates/{id}/usage

**Resource:** [templates](../resources/templates.md)
**List workspaces (owned by the current user) that reference this template**
**Operation ID:** `get--api-templates-{id}-usage`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Usage list |
| 404 | Template not found |

**Success Response Schema** (inline):

Array

## Security

- **bearerAuth**
