# PUT /apps/v1/users/{external_id}

**Resource:** [apps](../resources/apps.md)
**Provision a user of the application, or update its name and email**
**Operation ID:** `put--apps-v1-users-{external_id}`

Idempotent. The user belongs to the calling application, has no password and cannot sign in to NAP; it joins the teams the application declares. Call it whenever the user signs in to the application.

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `external_id` | path | string | Yes | The application's own id for the user |

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `display_name` | string | Yes |  |
| `email` | string,null (email) | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | The user already existed and was updated |
| 201 | The user was created |

**Success Response Schema:**

[AppUser](../schemas/App/AppUser.md)

## Security

- **appClientAuth**
