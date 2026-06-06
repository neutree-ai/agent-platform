# PATCH /api/workspaces/{id}/schedules/{scheduleId}

**Resource:** [workspaces](../resources/workspaces.md)
**Update a schedule. Re-registers the pg-boss timer when cron / run_at / timezone / enabled change.**
**Operation ID:** `patch--api-workspaces-{id}-schedules-{scheduleId}`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `scheduleId` | path | string | Yes |  |

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | No |  |
| `cron` | string,null | No |  |
| `run_at` | string,null (date-time) | No |  |
| `timezone` | string | No |  |
| `prompt` | string | No |  |
| `prompt_id` | string,null | No |  |
| `enabled` | boolean | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Updated schedule |
| 400 | Invalid input |
| 404 | Workspace or schedule not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `schedule` | object | Yes |  |

**`schedule` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes |  |
| `workspace_id` | string | Yes |  |
| `user_id` | string | Yes |  |
| `name` | string | Yes |  |
| `cron` | string,null | Yes |  |
| `run_at` | string,null | Yes |  |
| `timezone` | string | Yes |  |
| `prompt` | string | Yes |  |
| `prompt_id` | string,null | Yes |  |
| `prompt_content` | string,null | Yes |  |
| `enabled` | boolean | Yes |  |
| `origin` | enum: local, template | Yes |  |
| `last_run_at` | string,null | Yes |  |
| `completed_at` | string,null | Yes |  |
| `created_at` | string | Yes |  |
| `updated_at` | string | Yes |  |

## Security

- **bearerAuth**
