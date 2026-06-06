# POST /api/teams

**Resource:** [teams](../resources/teams.md)
**Create a team. The creator becomes its first admin.**
**Operation ID:** `post--api-teams`

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes |  |
| `description` | string | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 201 | Created team |

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
