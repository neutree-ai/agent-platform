# PUT /api/environments/{id}/grants

**Resource:** [environments](../resources/environments.md)
**Replace team grants (owner only)**
**Operation ID:** `put--api-environments-{id}-grants`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `grants` | object[] | Yes |  |

**`grants` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `team_id` | string | Yes |  |
| `permission` | enum: viewer, editor | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Grants |
| 400 | Invalid grants |
| 404 | Not found or not owner |

**Success Response Schema** (inline):

Array

## Security

- **bearerAuth**
