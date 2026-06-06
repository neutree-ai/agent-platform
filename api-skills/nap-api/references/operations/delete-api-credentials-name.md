# DELETE /api/credentials/{name}

**Resource:** [credentials](../resources/credentials.md)
**Soft-delete a credential, then hard-delete once all running workspaces reloaded**
**Operation ID:** `delete--api-credentials-{name}`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `name` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Deleted |
| 404 | Credential not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | boolean | Yes |  |

## Security

- **bearerAuth**
