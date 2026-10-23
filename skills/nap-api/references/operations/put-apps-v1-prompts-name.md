# PUT /apps/v1/prompts/{name}

**Resource:** [apps](../resources/apps.md)
**Publish a prompt**
**Operation ID:** `put--apps-v1-prompts-{name}`

Creates the prompt, or adds a version when the text differs from the current one.

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `name` | path | string | Yes | The application's own name for it |

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `content` | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | The prompt already existed |
| 201 | The prompt was created |

**Success Response Schema:**

[AppPrompt](../schemas/App/AppPrompt.md)

## Security

- **appClientAuth**
