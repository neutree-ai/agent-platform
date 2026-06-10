# POST /api/workspaces/{id}/schedules/{scheduleId}/run

**Resource:** [workspaces](../resources/workspaces.md)
**Trigger a schedule immediately, bypassing its scheduled time**
**Operation ID:** `post--api-workspaces-{id}-schedules-{scheduleId}-run`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `scheduleId` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Run enqueued |
| 404 | Workspace or schedule not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `job_id` | string,null | Yes |  |

## Security

- **bearerAuth**
