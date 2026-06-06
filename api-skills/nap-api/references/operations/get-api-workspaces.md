# GET /api/workspaces

**Resource:** [workspaces](../resources/workspaces.md)
**List workspaces visible to the current caller**
**Operation ID:** `get--api-workspaces`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `search` | query | string | No |  |
| `limit` | query | integer | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | List of workspaces |

**Success Response Schema** (inline):

Array

## Security

- **bearerAuth**
