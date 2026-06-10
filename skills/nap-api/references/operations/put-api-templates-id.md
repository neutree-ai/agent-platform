# PUT /api/templates/{id}

**Resource:** [templates](../resources/templates.md)
**Update template metadata. Owner: anything. Editor: name/description only.**
**Operation ID:** `put--api-templates-{id}`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | No |  |
| `description` | string | No |  |
| `visibility` | enum: private, team, public | No |  |
| `grants` | object[] | No |  |

**`grants` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `team_id` | string | Yes |  |
| `permission` | enum: viewer, editor | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Updated |
| 400 | Invalid grants or link visibility violation |
| 403 | Not allowed to update this template |
| 404 | Template not found |

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
