# GET /api/prompts

**Resource:** [prompts](../resources/prompts.md)
**List prompts visible to the user (own + public + team-shared)**
**Operation ID:** `get--api-prompts`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `workspace_id` | query | string | No | List as this workspace's owner — for picking resources to attach to it. |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Prompt list |
| 404 | Workspace not found |

**Success Response Schema** (inline):

Array

## Security

- **bearerAuth**
