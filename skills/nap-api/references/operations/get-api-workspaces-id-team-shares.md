# GET /api/workspaces/{id}/team-shares

**Resource:** [workspaces](../resources/workspaces.md)
**List the teams a workspace is shared with**
**Operation ID:** `get--api-workspaces-{id}-team-shares`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Team shares |
| 404 | Not found |

**Success Response Schema** (inline):

Array

## Security

- **bearerAuth**
