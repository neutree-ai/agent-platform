# POST /api/workspaces/{id}/sessions/{sessionId}/star

**Resource:** [workspaces](../resources/workspaces.md)
**Star or un-star a session**
**Operation ID:** `post--api-workspaces-{id}-sessions-{sessionId}-star`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `sessionId` | path | string | Yes |  |

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `starred` | boolean | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Updated |
| 404 | Workspace or session not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | boolean | Yes |  |
| `starred` | boolean | Yes |  |

## Security

- **bearerAuth**
