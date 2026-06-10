# POST /api/workspaces/{id}/schedules

**Resource:** [workspaces](../resources/workspaces.md)
**Create a schedule. Recurring (cron) or one-time (run_at); registers a pg-boss timer and rolls back the DB row on failure.**
**Operation ID:** `post--api-workspaces-{id}-schedules`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes |  |
| `cron` | string,null | No |  |
| `run_at` | string,null (date-time) | No |  |
| `timezone` | string | No |  |
| `prompt` | string | No |  |
| `prompt_id` | string,null | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 201 | Created schedule |
| 400 | Invalid input |
| 404 | Workspace not found |

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
