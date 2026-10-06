# GET /api/environments/{id}

**Resource:** [environments](../resources/environments.md)
**Get an environment the user can access**
**Operation ID:** `get--api-environments-{id}`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Environment |
| 404 | Not found or no access |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes |  |
| `name` | string | Yes |  |
| `visibility` | enum: private, team, public | Yes |  |
| `kind` | string | Yes |  |
| `status` | string | Yes |  |
| `capabilities` | object | Yes |  |
| `is_builtin` | boolean | Yes |  |
| `last_heartbeat_at` | string,null | Yes |  |
| `owner_name` | string | Yes |  |
| `is_own` | boolean | Yes |  |
| `my_permission` | enum: owner, editor, viewer... | Yes |  |
| `shared_via_teams` | object[] | Yes |  |
| `created_at` | string | Yes |  |

**`shared_via_teams` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes |  |
| `name` | string | Yes |  |
| `permission` | enum: viewer, editor | Yes |  |

## Security

- **bearerAuth**
