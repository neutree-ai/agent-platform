# POST /api/workspaces/{id}/commands/set-disabled

**Resource:** [workspaces](../resources/workspaces.md)
**Enable or disable a template-provided command for this workspace**
**Operation ID:** `post--api-workspaces-{id}-commands-set-disabled`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes |  |
| `disabled` | boolean | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Updated |
| 404 | Workspace not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | boolean | Yes |  |

## Security

- **bearerAuth**
