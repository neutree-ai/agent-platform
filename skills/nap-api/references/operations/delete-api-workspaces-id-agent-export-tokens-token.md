# DELETE /api/workspaces/{id}/agent/export-tokens/{token}

**Resource:** [agent-files](../resources/agent-files.md)
**Revoke (hard-delete) a public file URL**
**Operation ID:** `delete--api-workspaces-{id}-agent-export-tokens-{token}`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `token` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 204 | Revoked |
| 404 | Workspace or token not found |

## Security

- **bearerAuth**
