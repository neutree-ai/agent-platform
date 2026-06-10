# PATCH /api/teams/{id}/members/{userId}

**Resource:** [teams](../resources/teams.md)
**Change a member's role (admin only)**
**Operation ID:** `patch--api-teams-{id}-members-{userId}`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `userId` | path | string | Yes |  |

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `role` | enum: admin, member | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Updated |
| 403 | Forbidden |
| 404 | Not found |
| 409 | Conflict |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | boolean | Yes |  |

## Security

- **bearerAuth**
