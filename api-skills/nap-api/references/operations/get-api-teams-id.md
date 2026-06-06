# GET /api/teams/{id}

**Resource:** [teams](../resources/teams.md)
**Get team detail (members only)**
**Operation ID:** `get--api-teams-{id}`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Team |
| 404 | Not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes |  |
| `name` | string | Yes |  |
| `description` | string,null | Yes |  |
| `created_by` | string | Yes |  |
| `created_at` | string | Yes |  |
| `updated_at` | string | Yes |  |
| `my_role` | enum: admin, member | Yes |  |
| `member_count` | integer | Yes |  |

## Security

- **bearerAuth**
