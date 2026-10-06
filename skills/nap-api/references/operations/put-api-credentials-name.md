# PUT /api/credentials/{name}

**Resource:** [credentials](../resources/credentials.md)
**Upsert a credential. For env injection the name must be a valid env var identifier. Omit value to update only the metadata of an existing credential.**
**Operation ID:** `put--api-credentials-{name}`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `name` | path | string | Yes |  |

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `value` | string | No |  |
| `inject` | enum: env, file | Yes |  |
| `path` | string | No |  |
| `mode` | string | No |  |
| `scope` | enum: global, selected | No |  |
| `workspace_ids` | string[] | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Upserted |
| 400 | Invalid input |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | boolean | Yes |  |

## Security

- **bearerAuth**
