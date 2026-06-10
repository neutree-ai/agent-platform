# PUT /api/skills/{id}/grants

**Resource:** [skills](../resources/skills.md)
**Replace team grants for a skill (owner only)**
**Operation ID:** `put--api-skills-{id}-grants`

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
| 400 | Invalid grants |
| 404 | Skill not found |

**Success Response Schema** (inline):

Array

## Security

- **bearerAuth**
