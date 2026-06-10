# PUT /api/workspaces/{id}/sessions/{sessionId}/pending

**Resource:** [workspaces](../resources/workspaces.md)
**Set the queued follow-up message for a session**
**Operation ID:** `put--api-workspaces-{id}-sessions-{sessionId}-pending`

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
| `content` | string | Yes |  |
| `images` | object[] | Yes |  |

**`images` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `data` | string | Yes |  |
| `media_type` | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Saved |
| 404 | Workspace or session not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | boolean | Yes |  |

## Security

- **bearerAuth**
