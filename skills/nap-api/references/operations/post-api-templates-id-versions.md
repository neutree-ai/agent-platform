# POST /api/templates/{id}/versions

**Resource:** [templates](../resources/templates.md)
**Create a new version of a template (owner or editor)**
**Operation ID:** `post--api-templates-{id}-versions`

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
| `system_prompt` | string | No |  |
| `prompt_id` | string,null | No |  |
| `prompt_version` | integer,null | No |  |
| `mcp_config` | string | No |  |
| `agent_settings` | string | No |  |
| `compute_resources` | object | No |  |
| `provider_id` | string,null | No |  |
| `model` | string | No |  |
| `small_model` | string | No |  |
| `skill_ids` | string[] | No |  |
| `skill_names` | string[] | No |  |
| `from_workspace_id` | string | No |  |
| `include_commands` | boolean | No |  |
| `include_schedules` | boolean | No |  |
| `include_layout` | boolean | No |  |
| `commands` | object[] | No |  |
| `schedules` | object[] | No |  |

**`commands` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes |  |
| `type` | enum: plain, struct | No |  |
| `prompt_id` | string,null | No |  |
| `content` | string | No |  |
| `sort_order` | integer | No |  |

**`schedules` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes |  |
| `cron` | string | Yes |  |
| `timezone` | string | No |  |
| `prompt` | string | No |  |
| `prompt_id` | string,null | No |  |
| `enabled_default` | boolean | No |  |
| `sort_order` | integer | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 201 | Created version |
| 400 | New version would break link visibility for shared template |
| 403 | Not allowed to add versions to this template |
| 404 | Template not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes |  |
| `template_id` | string | Yes |  |
| `version` | integer | Yes |  |
| `agent_type` | string | Yes |  |
| `system_prompt` | string | Yes |  |
| `prompt_id` | string,null | Yes |  |
| `prompt_version` | integer,null | Yes |  |
| `mcp_config` | string | Yes |  |
| `agent_settings` | string | Yes |  |
| `compute_resources` | object | Yes |  |
| `provider_id` | string,null | Yes |  |
| `provider_name` | string,null | Yes |  |
| `model` | string | Yes |  |
| `small_model` | string | Yes |  |
| `skill_ids` | string[] | Yes |  |
| `skill_names` | string[] | Yes |  |
| `commands` | object[] | Yes |  |
| `schedules` | object[] | Yes |  |
| `layout_id` | string,null | Yes |  |
| `created_at` | string | Yes |  |

**`commands` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes |  |
| `name` | string | Yes |  |
| `type` | enum: plain, struct | Yes |  |
| `prompt_id` | string,null | Yes |  |
| `content` | string | Yes |  |
| `sort_order` | integer | Yes |  |

**`schedules` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes |  |
| `name` | string | Yes |  |
| `cron` | string | Yes |  |
| `timezone` | string | Yes |  |
| `prompt` | string | Yes |  |
| `prompt_id` | string,null | Yes |  |
| `enabled_default` | boolean | Yes |  |
| `sort_order` | integer | Yes |  |

## Security

- **bearerAuth**
