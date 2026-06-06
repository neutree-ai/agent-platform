# PATCH /api/workspaces/{id}/sessions/{sessionId}

**Resource:** [workspaces](../resources/workspaces.md)
**Rename a session**
**Operation ID:** `patch--api-workspaces-{id}-sessions-{sessionId}`

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
| `name` | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Renamed |
| 400 | Invalid input |
| 404 | Workspace or session not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | boolean | Yes |  |

## Security

- **bearerAuth**
