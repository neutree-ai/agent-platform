# GET /api/shares/public/{id}

**Resource:** [shares](../resources/shares.md)
**Public share view (no authentication required)**
**Operation ID:** `get--api-shares-public-{id}`

Auth bypass is configured via path prefix in index.ts.

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Share snapshot |
| 404 | Share not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | Yes |  |
| `created_at` | string | Yes |  |
| `owner_name` | string | Yes |  |
| `messages` | object[] | Yes |  |
| `turnStats` | object,null | Yes |  |
| `workspaceConfig` | object,null | Yes |  |
| `trigger` | object,null | Yes |  |

**`messages` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes |  |
| `role` | enum: user, assistant | Yes |  |
| `content` | string | Yes |  |
| `blocks` | any[] | Yes |  |
| `created_at` | string | Yes |  |
| `started_at` | string | Yes |  |
| `ended_at` | string,null | Yes |  |
| `duration_ms` | number,null | Yes |  |

