# DELETE /api/workspaces/{id}/afs/shares/{shareId}/grants/{teamId}

**Resource:** [afs](../resources/afs.md)
**Take a folder's grant from a team. Mounts no other grant allows are unmounted. Owner only.**
**Operation ID:** `delete--api-workspaces-{id}-afs-shares-{shareId}-grants-{teamId}`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `shareId` | path | string | Yes |  |
| `teamId` | path | string | Yes |  |

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
