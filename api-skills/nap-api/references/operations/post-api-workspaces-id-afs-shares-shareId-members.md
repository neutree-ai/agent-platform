# POST /api/workspaces/{id}/afs/shares/{shareId}/members

**Resource:** [afs](../resources/afs.md)
**Grant another workspace access to this share. Owner only.**
**Operation ID:** `post--api-workspaces-{id}-afs-shares-{shareId}-members`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `shareId` | path | string | Yes |  |

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `workspace_id` | string | Yes | Workspace to grant access to. |
| `readonly` | boolean | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 201 | Granted |
| 403 | Not owner |
| 404 | Not found |
| 502 | afs mount failed |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `workspace_id` | string | Yes |  |
| `permission` | enum: read_only, read_write | Yes |  |
| `mounted_at` | string | Yes |  |

## Security

- **bearerAuth**
