# GET /api/providers

**Resource:** [providers](../resources/providers.md)
**List providers visible to the user (own + public + team-shared)**
**Operation ID:** `get--api-providers`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `workspace_id` | query | string | No | List as this workspace's owner — for picking resources to attach to it. |

## Responses

| Status | Description |
|--------|-------------|
| 200 | List of providers (api_key redacted) |
| 404 | Workspace not found |

**Success Response Schema** (inline):

Array

## Security

- **bearerAuth**
