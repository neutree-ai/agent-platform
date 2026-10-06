# GET /api/workspaces/{id}/skills

**Resource:** [workspaces](../resources/workspaces.md)
**List the skills attached to a workspace**
**Operation ID:** `get--api-workspaces-{id}-skills`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Attached skills |
| 404 | Workspace not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `skills` | object[] | Yes |  |

**`skills` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes |  |
| `name` | string | Yes |  |
| `editable` | boolean | Yes |  |
| `gitSource` | boolean | Yes |  |

## Security

- **bearerAuth**
