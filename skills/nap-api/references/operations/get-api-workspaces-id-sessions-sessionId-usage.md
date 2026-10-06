# GET /api/workspaces/{id}/sessions/{sessionId}/usage

**Resource:** [workspaces](../resources/workspaces.md)
**Get token usage for one session**
**Operation ID:** `get--api-workspaces-{id}-sessions-{sessionId}-usage`

Sums the usage ledger for a single session, split by the model that spent
it. Cache tiers stay in their own columns — cache reads routinely dwarf
input volume at a fraction of the price, so a combined number misranks cost.

`settlement` says whether the ledger already holds everything the session
spent. Usage arrives by pulling the agent transcripts and the pull fired at
the end of a turn is detached, so a read taken immediately can be short —
poll until `complete`, which for a session that just ended takes about as
long as the parser's settle grace. `reason` distinguishes an account that
is still converging from one nothing will advance.

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `sessionId` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Session usage |
| 404 | Workspace or session not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `session_id` | string | Yes |  |
| `totals` | object | Yes |  |
| `by_model` | object[] | Yes |  |
| `first_ts` | string,null | Yes |  |
| `last_ts` | string,null | Yes |  |
| `settlement` | object | Yes |  |

**`totals` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `input_tokens` | number | Yes |  |
| `output_tokens` | number | Yes |  |
| `cache_read_tokens` | number | Yes |  |
| `cache_creation_tokens` | number | Yes |  |
| `cache_creation_5m_tokens` | number | Yes |  |
| `cache_creation_1h_tokens` | number | Yes |  |
| `reasoning_output_tokens` | number | Yes |  |
| `web_search_requests` | number | Yes |  |
| `record_count` | number | Yes |  |

**`by_model` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `input_tokens` | number | Yes |  |
| `output_tokens` | number | Yes |  |
| `cache_read_tokens` | number | Yes |  |
| `cache_creation_tokens` | number | Yes |  |
| `cache_creation_5m_tokens` | number | Yes |  |
| `cache_creation_1h_tokens` | number | Yes |  |
| `reasoning_output_tokens` | number | Yes |  |
| `web_search_requests` | number | Yes |  |
| `record_count` | number | Yes |  |
| `source` | string | Yes |  |
| `model` | string | Yes |  |

**`settlement` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `complete` | boolean | Yes |  |
| `drained_through` | string,null | Yes |  |
| `activity_at` | string,null | Yes |  |
| `reason` | enum: turn_in_progress, pending_settle, agent_unreachable... | Yes |  |

## Security

- **bearerAuth**
