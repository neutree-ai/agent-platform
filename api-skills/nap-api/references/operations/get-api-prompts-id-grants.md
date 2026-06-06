# GET /api/prompts/{id}/grants

**Resource:** [prompts](../resources/prompts.md)
**List team grants for a prompt (owner only)**
**Operation ID:** `get--api-prompts-{id}-grants`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Grant list |
| 404 | Prompt not found |

**Success Response Schema** (inline):

Array

## Security

- **bearerAuth**
