# POST /api/workspaces/{id}/transfer

**Resource:** [workspaces](../resources/workspaces.md)
**Offer the workspace to another user**
**Operation ID:** `post--api-workspaces-{id}-transfer`

Opens a pending transfer; the recipient accepts or declines it. The workspace keeps running and stays the sender’s until then.

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `to_username` | string | Yes |  |
| `copy` | object | Yes |  |
| `acknowledge_risks` | enum: true | Yes |  |

**`copy` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `prompts` | string[] | Yes |  |
| `skills` | string[] | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 201 | Transfer opened |
| 400 | Invalid request |
| 404 | Not found |
| 409 | Conflict |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes |  |
| `workspace_id` | string | Yes |  |
| `workspace_name` | string | Yes |  |
| `from_user` | object | Yes |  |
| `to_user` | object | Yes |  |
| `initiated_by` | string | Yes |  |
| `status` | enum: pending, executing, completed... | Yes |  |
| `copy` | object | Yes |  |
| `error` | string,null | Yes |  |
| `created_at` | string | Yes |  |
| `expires_at` | string | Yes |  |
| `resolved_at` | string,null | Yes |  |

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

**`copy` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `prompts` | string[] | Yes |  |
| `skills` | string[] | Yes |  |

## Security

- **bearerAuth**
