# GET /api/workspaces/{id}/session-usage

**Resource:** [workspaces](../resources/workspaces.md)
**A workspace's top sessions by token spend over the last `days` days, each with its message count, tool-call count and wall-clock duration.**
**Operation ID:** `get--api-workspaces-{id}-session-usage`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `days` | query | integer | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Session usage |
| 404 | Workspace not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessions` | object[] | Yes |  |

**`sessions` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionId` | string | Yes |  |
| `name` | string | Yes |  |
| `tokens` | integer | Yes |  |
| `messages` | integer | Yes |  |
| `toolCalls` | integer | Yes |  |
| `durationSec` | integer | Yes |  |
| `lastActiveAt` | string,null | Yes |  |

## Security

- **bearerAuth**
