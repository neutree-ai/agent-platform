# GET /api/workspaces/{id}/sessions/{sessionId}/tool-activity

**Resource:** [workspaces](../resources/workspaces.md)
**Get a session's tool calls, aggregated by tool and spread over time**
**Operation ID:** `get--api-workspaces-{id}-sessions-{sessionId}-tool-activity`

Where a session's wall clock went: how much of it was spent inside a tool
(overlap counted once, since sub-agents run tools concurrently), which tools
spent it, and how that spending was distributed across the session.

The distribution is the useful part. An agent repeating one tool without
making progress is indistinguishable from a busy one by any single total,
but shows up in the buckets as a long unbroken stretch of one tool.

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `sessionId` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Session tool activity |
| 404 | Workspace or session not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `wallMs` | integer | Yes |  |
| `toolMs` | integer | Yes |  |
| `timedCalls` | integer | Yes |  |
| `tools` | object[] | Yes |  |
| `chartedTools` | string[] | Yes |  |
| `otherToolCount` | integer | Yes |  |
| `buckets` | object[] | Yes |  |
| `startedAt` | string,null | Yes |  |
| `endedAt` | string,null | Yes |  |

**`tools` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes |  |
| `calls` | integer | Yes |  |
| `timedCalls` | integer | Yes |  |
| `seconds` | integer | Yes |  |
| `avgSeconds` | number | Yes |  |
| `errors` | integer | Yes |  |

**`buckets` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `startedAt` | string,null | Yes |  |
| `tools` | object | Yes |  |

## Security

- **bearerAuth**
