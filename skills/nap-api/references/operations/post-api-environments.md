# POST /api/environments

**Resource:** [environments](../resources/environments.md)
**Register a remote environment**
**Operation ID:** `post--api-environments`

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes |  |
| `kind` | string | No |  |
| `visibility` | enum: private, team, public | No |  |
| `placement` | object | No |  |
| `grants` | object[] | No |  |

**`grants` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `team_id` | string | Yes |  |
| `permission` | enum: viewer, editor | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 201 | Created |
| 400 | Invalid grants for visibility |
| 403 | Non-admin attempting to create a public environment |
| 409 | Name already in use |

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
