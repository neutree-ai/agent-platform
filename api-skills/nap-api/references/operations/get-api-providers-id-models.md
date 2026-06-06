# GET /api/providers/{id}/models

**Resource:** [providers](../resources/providers.md)
**List models available via this provider**
**Operation ID:** `get--api-providers-{id}-models`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Model list (may include an error when the upstream call failed) |
| 404 | Provider not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `models` | object[] | Yes |  |
| `error` | string | No |  |

**`models` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes |  |
| `name` | string | Yes |  |

## Security

- **bearerAuth**
