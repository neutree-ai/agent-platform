# PUT /api/workspaces/{id}/afs/shares/{shareId}/grants/{teamId}

**Resource:** [afs](../resources/afs.md)
**Grant a folder to a team the owner is in, or change the grant's permission. Members of the team can then mount it in their workspaces, at up to that permission; lowering it takes effect on their mounts.**
**Operation ID:** `put--api-workspaces-{id}-afs-shares-{shareId}-grants-{teamId}`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `shareId` | path | string | Yes |  |
| `teamId` | path | string | Yes |  |

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `permission` | enum: read_only, read_write | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Granted |
| 403 | Not owner, or not in the team |
| 404 | Not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | boolean | Yes |  |

## Security

- **bearerAuth**
