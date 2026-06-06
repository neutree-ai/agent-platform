# POST /api/teams/{id}/members

**Resource:** [teams](../resources/teams.md)
**Add a user to the team (admin only)**
**Operation ID:** `post--api-teams-{id}-members`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `user_id` | string | Yes |  |
| `role` | enum: admin, member | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 201 | Added |
| 400 | Bad request |
| 403 | Forbidden |
| 404 | Not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `user_id` | string | Yes |  |
| `user_name` | string | Yes |  |
| `role` | enum: admin, member | Yes |  |
| `joined_at` | string | Yes |  |

## Security

- **bearerAuth**
