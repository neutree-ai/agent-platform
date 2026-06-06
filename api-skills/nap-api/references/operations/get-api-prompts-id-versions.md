# GET /api/prompts/{id}/versions

**Resource:** [prompts](../resources/prompts.md)
**List prompt versions (visibility-aware)**
**Operation ID:** `get--api-prompts-{id}-versions`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Version list |
| 404 | Prompt not found |

**Success Response Schema** (inline):

Array

## Security

- **bearerAuth**
