# PATCH /api/workspaces/{workspaceId}/memory-attachments/{storeId}

**Resource:** [workspace-memory](../resources/workspace-memory.md)
**Operation ID:** `patch--api-workspaces-{workspaceId}-memory-attachments-{storeId}`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `workspaceId` | path | string | Yes |  |
| `storeId` | path | string | Yes |  |

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `access` | enum: read_only, read_write | No |  |
| `instructions` | string | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | OK |
| 403 | Forbidden |
| 404 | Not found |

**Success Response Schema** (inline):

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
