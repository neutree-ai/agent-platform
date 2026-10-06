# DELETE /api/workspaces/{id}/transfer

**Resource:** [workspaces](../resources/workspaces.md)
**Cancel the workspace’s pending transfer**
**Operation ID:** `delete--api-workspaces-{id}-transfer`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Cancelled |
| 404 | Not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | boolean | Yes |  |

## Security

- **bearerAuth**
