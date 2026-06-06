# POST /api/workspaces/{workspaceId}/memory-attachments

**Resource:** [workspace-memory](../resources/workspace-memory.md)
**Operation ID:** `post--api-workspaces-{workspaceId}-memory-attachments`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `workspaceId` | path | string | Yes |  |

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `store_id` | string | Yes |  |
| `access` | enum: read_only, read_write | No |  |
| `instructions` | string | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 201 | Attached |
| 400 | Cluster unsupported |
| 403 | Forbidden |
| 404 | Not found |
| 409 | Cap reached |

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
