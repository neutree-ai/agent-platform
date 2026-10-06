# GET /api/workspaces/{id}/sessions/facets

**Resource:** [workspaces](../resources/workspaces.md)
**Session counts per filter facet**
**Operation ID:** `get--api-workspaces-{id}-sessions-facets`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Counts per source and status, plus starred and total |
| 404 | Workspace not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `source` | object | Yes |  |
| `status` | object | Yes |  |
| `starred` | integer | Yes |  |
| `total` | integer | Yes |  |

## Security

- **bearerAuth**
