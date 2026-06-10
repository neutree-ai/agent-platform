# workspaces

A workspace is an isolated agent environment — its own filesystem, config, and a running agent. Most other resources hang off a workspace `{id}`. Create with POST, change model/prompt/compute via PUT `.../config`, and give the agent work via the `chat` resource.

## Operations

| Method | Path | Summary | Details |
|--------|------|---------|----------|
| GET | `/api/workspaces` | List workspaces visible to the current caller | [View](../operations/get-api-workspaces.md) |
| POST | `/api/workspaces` | Create a workspace | [View](../operations/post-api-workspaces.md) |
| GET | `/api/workspaces/{id}/messages` | List messages for a session within a workspace | [View](../operations/get-api-workspaces-id-messages.md) |
| GET | `/api/workspaces/{id}/sessions` | List sessions for a workspace | [View](../operations/get-api-workspaces-id-sessions.md) |
| GET | `/api/workspaces/{id}/config` | Get workspace agent configuration | [View](../operations/get-api-workspaces-id-config.md) |
| PUT | `/api/workspaces/{id}/config` | Update workspace agent configuration | [View](../operations/put-api-workspaces-id-config.md) |
| GET | `/api/workspaces/{id}/status` | Get workspace runtime (K8s) status | [View](../operations/get-api-workspaces-id-status.md) |
| DELETE | `/api/workspaces/{id}` | Delete a workspace and its underlying instance | [View](../operations/delete-api-workspaces-id.md) |
| PATCH | `/api/workspaces/{id}` | Rename a workspace or change its slug / visibility | [View](../operations/patch-api-workspaces-id.md) |
| POST | `/api/workspaces/{id}/start` | Start (or rebuild) a workspace instance | [View](../operations/post-api-workspaces-id-start.md) |
| POST | `/api/workspaces/{id}/stop` | Stop a workspace instance | [View](../operations/post-api-workspaces-id-stop.md) |
| POST | `/api/workspaces/{id}/save-as-template` | Snapshot a workspace into a new template | [View](../operations/post-api-workspaces-id-save-as-template.md) |
| POST | `/api/workspaces/{id}/sync-template` | Sync a workspace to its bound template’s latest version | [View](../operations/post-api-workspaces-id-sync-template.md) |
| GET | `/api/workspaces/{id}/sessions/{sessionId}` | Get a single session (lightweight, sidebar shape) | [View](../operations/get-api-workspaces-id-sessions-sessionId.md) |
| DELETE | `/api/workspaces/{id}/sessions/{sessionId}` | Delete a session and its messages | [View](../operations/delete-api-workspaces-id-sessions-sessionId.md) |
| PATCH | `/api/workspaces/{id}/sessions/{sessionId}` | Rename a session | [View](../operations/patch-api-workspaces-id-sessions-sessionId.md) |
| POST | `/api/workspaces/{id}/sessions/{sessionId}/star` | Star or un-star a session | [View](../operations/post-api-workspaces-id-sessions-sessionId-star.md) |
| POST | `/api/workspaces/{id}/sessions/{sessionId}/interrupt` | Interrupt a single session (soft stop, preserves history) | [View](../operations/post-api-workspaces-id-sessions-sessionId-interrupt.md) |
| PUT | `/api/workspaces/{id}/sessions/{sessionId}/pending` | Set the queued follow-up message for a session | [View](../operations/put-api-workspaces-id-sessions-sessionId-pending.md) |
| DELETE | `/api/workspaces/{id}/sessions/{sessionId}/pending` | Drop the queued follow-up message for a session | [View](../operations/delete-api-workspaces-id-sessions-sessionId-pending.md) |
| GET | `/api/workspaces/{id}/usage` | Get aggregate token usage for a workspace | [View](../operations/get-api-workspaces-id-usage.md) |
| GET | `/api/workspaces/{id}/commands` | List workspace commands | [View](../operations/get-api-workspaces-id-commands.md) |
| POST | `/api/workspaces/{id}/commands` | Create a command. Either prompt_id or content must be provided. | [View](../operations/post-api-workspaces-id-commands.md) |
| DELETE | `/api/workspaces/{id}/commands/{cmdId}` | Delete a command | [View](../operations/delete-api-workspaces-id-commands-cmdId.md) |
| PATCH | `/api/workspaces/{id}/commands/{cmdId}` | Update a command | [View](../operations/patch-api-workspaces-id-commands-cmdId.md) |
| POST | `/api/workspaces/{id}/commands/set-disabled` | Enable or disable a template-provided command for this workspace | [View](../operations/post-api-workspaces-id-commands-set-disabled.md) |
| GET | `/api/workspaces/{id}/schedules` | List schedules for a workspace | [View](../operations/get-api-workspaces-id-schedules.md) |
| POST | `/api/workspaces/{id}/schedules` | Create a schedule. Recurring (cron) or one-time (run_at); registers a pg-boss timer and rolls back the DB row on failure. | [View](../operations/post-api-workspaces-id-schedules.md) |
| DELETE | `/api/workspaces/{id}/schedules/{scheduleId}` | Delete a schedule and unregister its pg-boss timer | [View](../operations/delete-api-workspaces-id-schedules-scheduleId.md) |
| PATCH | `/api/workspaces/{id}/schedules/{scheduleId}` | Update a schedule. Re-registers the pg-boss timer when cron / run_at / timezone / enabled change. | [View](../operations/patch-api-workspaces-id-schedules-scheduleId.md) |
| POST | `/api/workspaces/{id}/schedules/{scheduleId}/run` | Trigger a schedule immediately, bypassing its scheduled time | [View](../operations/post-api-workspaces-id-schedules-scheduleId-run.md) |
| GET | `/api/workspaces/{id}/agent-requests/{reqId}` | Read a single agent_request for human-in-loop review. | [View](../operations/get-api-workspaces-id-agent-requests-reqId.md) |
| POST | `/api/workspaces/{id}/agent-requests/{reqId}/resolve` | Approve or reject a pending agent_request. | [View](../operations/post-api-workspaces-id-agent-requests-reqId-resolve.md) |
