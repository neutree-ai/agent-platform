# GET /api/workspaces/{id}/config

**Resource:** [workspaces](../resources/workspaces.md)
**Get workspace agent configuration**
**Operation ID:** `get--api-workspaces-{id}-config`

Returns the workspace config. `api_key` is always returned as an empty string; the stored value is write-only.

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Workspace agent configuration |
| 404 | Workspace or config not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `agent_type` | string | Yes |  |
| `provider_id` | string,null | Yes |  |
| `prompt_id` | string,null | Yes |  |
| `prompt_name` | string,null | Yes |  |
| `prompt_content` | string,null | Yes |  |
| `template_id` | string,null | Yes |  |
| `template_version` | integer,null | Yes |  |
| `template_name` | string,null | Yes |  |
| `template_latest_version` | integer,null | Yes |  |
| `provider_type` | string | Yes |  |
| `model` | string | Yes |  |
| `base_url` | string | Yes |  |
| `api_key` | string | Yes |  |
| `small_model` | string | Yes |  |
| `system_prompt` | string | Yes |  |
| `mcp_config` | string | Yes |  |
| `agent_settings` | string | Yes |  |
| `compute_resources` | object | Yes |  |
| `auto_start` | boolean | Yes |  |
| `user_display_name` | string,null | Yes |  |
| `memory_attachments` | object[] | No |  |

**`compute_resources` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `cpu_request` | string | No |  |
| `cpu_limit` | string | No |  |
| `memory_request` | string | No |  |
| `memory_limit` | string | No |  |
| `storage` | string | No |  |

**`memory_attachments` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `store_id` | string | Yes |  |
| `store_name` | string | Yes |  |
| `store_description` | string | Yes |  |
| `access` | enum: read_only, read_write | Yes |  |
| `instructions` | string | Yes |  |
| `index_content` | string,null | Yes |  |

## Security

- **bearerAuth**
