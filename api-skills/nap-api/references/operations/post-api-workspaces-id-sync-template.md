# POST /api/workspaces/{id}/sync-template

**Resource:** [workspaces](../resources/workspaces.md)
**Sync a workspace to its bound template’s latest version**
**Operation ID:** `post--api-workspaces-{id}-sync-template`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `schedule_overrides` | object | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Synced |
| 400 | Workspace is not bound to a template, or is already at latest version |
| 403 | Latest template version uses skills not visible to the user |
| 404 | Workspace or template not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | boolean | Yes |  |
| `version` | integer | Yes |  |
| `reloaded` | boolean | No |  |

## Security

- **bearerAuth**
