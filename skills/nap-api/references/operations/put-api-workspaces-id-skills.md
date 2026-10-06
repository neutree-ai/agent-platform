# PUT /api/workspaces/{id}/skills

**Resource:** [workspaces](../resources/workspaces.md)
**Replace the workspace skill set and reload the agent**
**Operation ID:** `put--api-workspaces-{id}-skills`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `skills` | string[] | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Updated |
| 403 | A requested skill is not visible to this workspace |
| 404 | Workspace not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | enum: true | Yes |  |
| `reloaded` | boolean | Yes |  |

## Security

- **bearerAuth**
