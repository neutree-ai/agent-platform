# PUT /api/templates/{id}/grants

**Resource:** [templates](../resources/templates.md)
**Replace team grants for a template (owner only)**
**Operation ID:** `put--api-templates-{id}-grants`

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
| 200 | Grant list |
| 400 | Invalid grants or link visibility violation |
| 404 | Template not found |

**Success Response Schema** (inline):

Array

## Security

- **bearerAuth**
