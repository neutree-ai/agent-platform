# GET /api/workspaces/{id}/usage

**Resource:** [workspaces](../resources/workspaces.md)
**Get aggregate token usage for a workspace**
**Operation ID:** `get--api-workspaces-{id}-usage`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Workspace usage totals |
| 404 | Workspace not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `workspace_id` | string | Yes |  |
| `input_tokens` | number | Yes |  |
| `output_tokens` | number | Yes |  |
| `cache_read_tokens` | number | Yes |  |
| `cache_creation_tokens` | number | Yes |  |
| `reasoning_output_tokens` | number | Yes |  |
| `web_search_requests` | number | Yes |  |
| `record_count` | number | Yes |  |
| `last_used_at` | string,null | Yes |  |

## Security

- **bearerAuth**
