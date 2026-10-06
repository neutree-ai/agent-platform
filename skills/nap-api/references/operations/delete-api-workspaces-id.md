# DELETE /api/workspaces/{id}

**Resource:** [workspaces](../resources/workspaces.md)
**Delete a workspace and its underlying instance**
**Operation ID:** `delete--api-workspaces-{id}`

Collects the workspace's outstanding token usage into the ledger before
tearing it down — the volume goes with the workspace, so records left on
it cannot be recovered. This waits out the transcript settle grace, so the
call takes a few seconds longer than the teardown itself.

A running workspace that cannot be read answers 409: that is usually
transient and worth retrying. `force=true` deletes regardless, for an agent
wedged badly enough that waiting would never help.

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `force` | query | enum: true, false | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Deleted |
| 403 | Forbidden |
| 404 | Workspace not found |
| 409 | Usage could not be collected before deleting |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | boolean | Yes |  |

## Security

- **bearerAuth**
