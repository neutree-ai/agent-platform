# GET /api/templates/{id}/versions/{version}

**Resource:** [templates](../resources/templates.md)
**Get a specific version of a template**
**Operation ID:** `get--api-templates-{id}-versions-{version}`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `version` | path | integer,null | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Version |
| 404 | Template or version not found |

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
