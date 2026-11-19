# POST /api/workspaces/{id}/sandboxes/{sandboxId}/commands

**Resource:** [workspaces](../resources/workspaces.md)
**Run a shell command in a sandbox. Foreground returns stdout, stderr and exit_code; with background it returns a command_id to poll.**
**Operation ID:** `post--api-workspaces-{id}-sandboxes-{sandboxId}-commands`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `sandboxId` | path | string | Yes |  |

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `command` | string | Yes |  |
| `cwd` | string | No |  |
| `env` | object | No |  |
| `timeout_seconds` | number | No |  |
| `background` | boolean | No | Return as soon as the command starts; poll with the returned command_id |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Command result |
| 404 | Workspace or sandbox not found |
| 500 | Sandbox service error |

## Security

- **bearerAuth**
