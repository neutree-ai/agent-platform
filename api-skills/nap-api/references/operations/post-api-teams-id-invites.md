# POST /api/teams/{id}/invites

**Resource:** [teams](../resources/teams.md)
**Create an invite link (admin only). Default expiry 7 days.**
**Operation ID:** `post--api-teams-{id}-invites`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `expires_in_days` | integer | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 201 | Created |
| 403 | Forbidden |
| 404 | Not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `token` | string | Yes |  |
| `team_id` | string | Yes |  |
| `created_by` | string | Yes |  |
| `created_by_name` | string | Yes |  |
| `expires_at` | string,null | Yes |  |
| `created_at` | string | Yes |  |

## Security

- **bearerAuth**
