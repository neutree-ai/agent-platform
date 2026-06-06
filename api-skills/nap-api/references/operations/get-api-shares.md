# GET /api/shares

**Resource:** [shares](../resources/shares.md)
**List shares created for a given workspace session**
**Operation ID:** `get--api-shares`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `workspace_id` | query | string | Yes |  |
| `session_id` | query | string | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Share list |
| 404 | Workspace not found |

**Success Response Schema** (inline):

Array

## Security

- **bearerAuth**
