# GET /api/teams/{id}/members

**Resource:** [teams](../resources/teams.md)
**List team members (members only)**
**Operation ID:** `get--api-teams-{id}-members`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Members |
| 404 | Not found |

**Success Response Schema** (inline):

Array

## Security

- **bearerAuth**
