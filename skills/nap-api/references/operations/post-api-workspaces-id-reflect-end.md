# POST /api/workspaces/{id}/reflect/end

**Resource:** [workspaces](../resources/workspaces.md)
**Advance (or leave) a store's Reflect checkpoint after a turn ends**
**Operation ID:** `post--api-workspaces-{id}-reflect-end`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `store_id` | string | Yes |  |
| `session_id` | string | Yes |  |
| `success` | boolean | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | OK |
| 404 | Workspace, session, or store not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | boolean | Yes |  |

## Security

- **bearerAuth**
