# POST /api/workspaces/{id}/agent/export-url

**Resource:** [agent-files](../resources/agent-files.md)
**Mint a short-lived public URL for a workspace file**
**Operation ID:** `post--api-workspaces-{id}-agent-export-url`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | string | Yes |  |
| `ttl_seconds` | integer | No |  |
| `permanent` | boolean | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Public URL minted |
| 400 | Invalid path or service misconfigured |
| 404 | Workspace not found |
| 503 | Workspace not running |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | Yes |  |
| `expires_at` | string,null | Yes |  |

## Security

- **bearerAuth**
