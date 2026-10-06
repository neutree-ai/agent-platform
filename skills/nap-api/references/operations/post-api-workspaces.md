# POST /api/workspaces

**Resource:** [workspaces](../resources/workspaces.md)
**Create a workspace**
**Operation ID:** `post--api-workspaces`

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes |  |
| `template_id` | string | No |  |
| `is_system` | boolean | No |  |
| `environment_id` | string | No |  |
| `agent_type` | string | No |  |
| `compute_resources` | object | No |  |
| `provider_id` | string | No |  |
| `provider_type` | string | No |  |
| `base_url` | string | No |  |
| `api_key` | string | No |  |
| `model` | string | No |  |
| `small_model` | string | No |  |
| `prompt_id` | string | No |  |
| `system_prompt` | string | No |  |
| `mcp_config` | string | No |  |
| `agent_settings` | string | No |  |
| `skill_ids` | string[] | No |  |
| `skill_names` | string[] | No |  |
| `schedule_overrides` | object | No |  |
| `auto_scaling` | object | No |  |

**`auto_scaling` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `min_replicas` | integer | Yes |  |
| `max_replicas` | integer | Yes |  |
| `scale_to_zero_idle_seconds` | integer,null | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 201 | Created workspace |
| 400 | Invalid input |
| 403 | Forbidden |
| 404 | Template not found |
| 500 | Internal error |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes |  |
| `name` | string | Yes |  |
| `slug` | string,null | Yes |  |
| `visibility` | string | Yes |  |
| `is_system` | boolean | Yes |  |
| `owner` | string | Yes |  |
| `access` | enum: owner, shared | Yes |  |
| `is_shared` | boolean | Yes |  |
| `status` | string | Yes |  |
| `created_at` | string | Yes |  |
| `tag_ids` | string[] | Yes |  |
| `active_agent_sessions` | integer | Yes |  |
| `active_human_sessions` | integer | Yes |  |
| `active_sessions` | object[] | Yes |  |
| `rebuild_available` | boolean | Yes |  |

**`active_sessions` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes |  |
| `chat_status` | string | Yes |  |
| `preview` | string | Yes |  |
| `name` | string | No |  |

## Security

- **bearerAuth**
