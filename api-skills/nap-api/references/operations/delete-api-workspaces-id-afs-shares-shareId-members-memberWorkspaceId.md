# DELETE /api/workspaces/{id}/afs/shares/{shareId}/members/{memberWorkspaceId}

**Resource:** [afs](../resources/afs.md)
**Remove a member. Owner can remove any member; a member can remove themselves (leave).**
**Operation ID:** `delete--api-workspaces-{id}-afs-shares-{shareId}-members-{memberWorkspaceId}`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `shareId` | path | string | Yes |  |
| `memberWorkspaceId` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Removed |
| 403 | Forbidden |
| 404 | Not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | boolean | Yes |  |

## Security

- **bearerAuth**
