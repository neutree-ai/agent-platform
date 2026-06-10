# PATCH /api/teams/{id}

**Resource:** [teams](../resources/teams.md)
**Update team name/description (admin only)**
**Operation ID:** `patch--api-teams-{id}`

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
| `description` | string,null | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Updated |
| 403 | Forbidden |
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
