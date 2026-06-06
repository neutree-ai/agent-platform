# PUT /api/providers/{id}

**Resource:** [providers](../resources/providers.md)
**Update a model provider (owner only; empty api_key keeps existing value)**
**Operation ID:** `put--api-providers-{id}`

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
| `provider_type` | string | No |  |
| `base_url` | string | No |  |
| `api_key` | string | No |  |
| `is_public` | boolean | No |  |
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
| 200 | Updated provider |
| 400 | Invalid grants for visibility |
| 403 | Forbidden |
| 404 | Provider not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes |  |
| `name` | string | Yes |  |
| `description` | string | Yes |  |
| `provider_type` | string | Yes |  |
| `base_url` | string | Yes |  |
| `api_key` | string | Yes |  |
| `user_id` | string | Yes |  |
| `owner_name` | string | Yes |  |
| `is_owner` | boolean | Yes |  |
| `is_public` | boolean | Yes |  |
| `visibility` | enum: private, team, public | Yes |  |
| `my_permission` | enum: owner, editor, viewer... | Yes |  |
| `shared_via_teams` | object[] | Yes |  |
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
