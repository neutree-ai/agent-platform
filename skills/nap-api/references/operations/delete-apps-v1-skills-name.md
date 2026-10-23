# DELETE /apps/v1/skills/{name}

**Resource:** [apps](../resources/apps.md)
**Delete a skill**
**Operation ID:** `delete--apps-v1-skills-{name}`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `name` | path | string | Yes | The application's own name for it |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Deleted |
| 404 | Not found |
| 409 | Still in use |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | boolean | Yes |  |

## Security

- **appClientAuth**
