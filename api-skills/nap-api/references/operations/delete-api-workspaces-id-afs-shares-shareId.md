# DELETE /api/workspaces/{id}/afs/shares/{shareId}

**Resource:** [afs](../resources/afs.md)
**Revoke a shared folder. Force-unmounts every member.**
**Operation ID:** `delete--api-workspaces-{id}-afs-shares-{shareId}`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `shareId` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Revoked |
| 403 | Not owner |
| 404 | Not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | boolean | Yes |  |

## Security

- **bearerAuth**
