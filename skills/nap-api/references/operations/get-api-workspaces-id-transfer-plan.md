# GET /api/workspaces/{id}/transfer/plan

**Resource:** [workspaces](../resources/workspaces.md)
**Preview what transferring the workspace to a user would do**
**Operation ID:** `get--api-workspaces-{id}-transfer-plan`

The recipient is named by exact username; there is no search, so this cannot be used to enumerate users beyond confirming a known name.

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `to` | query | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Plan |
| 400 | Invalid request |
| 404 | Not found |
| 409 | Conflict |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `workspace` | object | Yes |  |
| `from_user` | object | Yes |  |
| `to_user` | object | Yes |  |
| `items` | object[] | Yes |  |
| `copyable` | object | Yes |  |
| `blocked` | boolean | Yes |  |
| `slug_conflict` | boolean | Yes |  |
| `suggested_slug` | string,null | Yes |  |
| `provider_required` | boolean | Yes |  |

**`workspace` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes |  |
| `name` | string | Yes |  |
| `slug` | string,null | Yes |  |

**`from_user` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes |  |
| `username` | string | Yes |  |
| `display_name` | string | Yes |  |

**`to_user` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes |  |
| `username` | string | Yes |  |
| `display_name` | string | Yes |  |

**`items` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `kind` | enum: files, sessions, schedules... | Yes |  |
| `action` | enum: move, keep, copy... | Yes |  |
| `id` | string,null | Yes |  |
| `name` | string,null | Yes |  |
| `count` | integer,null | Yes |  |

**`copyable` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `prompts` | object[] | Yes |  |
| `skills` | object[] | Yes |  |

## Security

- **bearerAuth**
