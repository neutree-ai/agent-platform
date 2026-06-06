# DELETE /api/workspaces/{id}/schedules/{scheduleId}

**Resource:** [workspaces](../resources/workspaces.md)
**Delete a schedule and unregister its pg-boss timer**
**Operation ID:** `delete--api-workspaces-{id}-schedules-{scheduleId}`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `scheduleId` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Deleted |
| 400 | Template-provided schedule cannot be deleted |
| 404 | Workspace or schedule not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | boolean | Yes |  |

## Security

- **bearerAuth**
