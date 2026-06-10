# GET /api/workspaces/{workspaceId}/memory-attachments

**Resource:** [workspace-memory](../resources/workspace-memory.md)
**Operation ID:** `get--api-workspaces-{workspaceId}-memory-attachments`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `workspaceId` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | OK |
| 403 | Forbidden |
| 404 | Not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `attachments` | object[] | Yes |  |

**`attachments` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `workspace_id` | string | Yes |  |
| `store_id` | string | Yes |  |
| `store_name` | string | Yes |  |
| `access` | enum: read_only, read_write | Yes |  |
| `instructions` | string | Yes |  |
| `created_at` | string | Yes |  |

## Security

- **bearerAuth**
