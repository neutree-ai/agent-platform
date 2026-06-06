# PUT /api/workspaces/{id}/config

**Resource:** [workspaces](../resources/workspaces.md)
**Update workspace agent configuration**
**Operation ID:** `put--api-workspaces-{id}-config`

Empty `api_key` is treated as "do not change". Changing `agent_type` while running rebuilds the container.

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `agent_type` | string | No |  |
| `provider_id` | string,null | No |  |
| `prompt_id` | string,null | No |  |
| `prompt_name` | string,null | No |  |
| `prompt_content` | string,null | No |  |
| `template_id` | string,null | No |  |
| `template_version` | integer,null | No |  |
| `template_name` | string,null | No |  |
| `template_latest_version` | integer,null | No |  |
| `provider_type` | string | No |  |
| `model` | string | No |  |
| `base_url` | string | No |  |
| `api_key` | string | No |  |
| `small_model` | string | No |  |
| `system_prompt` | string | No |  |
| `mcp_config` | string | No |  |
| `agent_settings` | string | No |  |
| `compute_resources` | object | No |  |
| `auto_start` | boolean | No |  |
| `user_display_name` | string,null | No |  |
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

## Responses

| Status | Description |
|--------|-------------|
| 200 | Config applied |
| 404 | Workspace not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | boolean | Yes |  |
| `reloaded` | boolean | No |  |
| `rebuilt` | boolean | No |  |

## Security

- **bearerAuth**
