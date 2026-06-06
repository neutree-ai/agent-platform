# DELETE /api/workspaces/{workspaceId}/memory-attachments/{storeId}

**Resource:** [workspace-memory](../resources/workspace-memory.md)
**Operation ID:** `delete--api-workspaces-{workspaceId}-memory-attachments-{storeId}`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `workspaceId` | path | string | Yes |  |
| `storeId` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | OK |
| 403 | Forbidden |
| 404 | Not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | boolean | Yes |  |

## Security

- **bearerAuth**
