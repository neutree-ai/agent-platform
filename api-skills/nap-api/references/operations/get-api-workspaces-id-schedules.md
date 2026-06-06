# GET /api/workspaces/{id}/schedules

**Resource:** [workspaces](../resources/workspaces.md)
**List schedules for a workspace**
**Operation ID:** `get--api-workspaces-{id}-schedules`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Schedule list |
| 404 | Workspace not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `schedules` | object[] | Yes |  |

**`schedules` fields:**

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
