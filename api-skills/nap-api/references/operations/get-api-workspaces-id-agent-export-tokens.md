# GET /api/workspaces/{id}/agent/export-tokens

**Resource:** [agent-files](../resources/agent-files.md)
**List active public file URLs for a workspace**
**Operation ID:** `get--api-workspaces-{id}-agent-export-tokens`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Active tokens |
| 404 | Workspace not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tokens` | object[] | Yes |  |

**`tokens` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `token` | string | Yes |  |
| `path` | string | Yes |  |
| `url` | string | Yes |  |
| `created_at` | string | Yes |  |
| `expires_at` | string,null | Yes |  |

## Security

- **bearerAuth**
