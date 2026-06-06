# POST /api/shares

**Resource:** [shares](../resources/shares.md)
**Create a share by snapshotting session messages, config and trigger**
**Operation ID:** `post--api-shares`

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `workspace_id` | string | Yes |  |
| `session_id` | string | Yes |  |
| `title` | string | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Created share |
| 404 | Workspace not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes |  |
| `url` | string | Yes |  |
| `title` | string | Yes |  |
| `created_at` | string | Yes |  |
| `session_id` | string | No |  |

## Security

- **bearerAuth**
