# POST /api/workspaces/{id}/save-as-template

**Resource:** [workspaces](../resources/workspaces.md)
**Snapshot a workspace into a new template**
**Operation ID:** `post--api-workspaces-{id}-save-as-template`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes |  |
| `description` | string | No |  |
| `bind` | boolean | No |  |
| `include_commands` | boolean | No |  |
| `include_schedules` | boolean | No |  |
| `include_layout` | boolean | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 201 | Template created |
| 400 | Invalid input |
| 404 | Workspace or config not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes |  |
| `name` | string | Yes |  |
| `description` | string | Yes |  |
| `owner_id` | string | Yes |  |
| `owner_name` | string | Yes |  |
| `is_owner` | boolean | Yes |  |
| `visibility` | enum: private, team, public | Yes |  |
| `my_permission` | enum: owner, editor, viewer... | Yes |  |
| `shared_via_teams` | object[] | Yes |  |
| `latest_version` | integer | Yes |  |
| `created_at` | string | Yes |  |
| `updated_at` | string | Yes |  |

**`shared_via_teams` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes |  |
| `name` | string | Yes |  |
| `permission` | enum: viewer, editor | Yes |  |

## Security

- **bearerAuth**
