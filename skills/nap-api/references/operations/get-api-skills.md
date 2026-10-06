# GET /api/skills

**Resource:** [skills](../resources/skills.md)
**List skills visible to the user (own + public + team-shared)**
**Operation ID:** `get--api-skills`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `workspace_id` | query | string | No | List as this workspace's owner — for picking skills to attach to it. |
| `q` | query | string | No | Case-insensitive substring match on name + description. |
| `owner` | query | string | No | Filter to skills whose owner is this user id. |
| `category` | query | string | No | Comma-separated list of categories (OR semantics). Pass the literal "uncategorized" to include skills with no category set. |
| `visibility` | query | enum: private, team, public | No | Restrict to skills with this visibility. |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Skill list |
| 404 | Workspace not found |

**Success Response Schema** (inline):

Array

## Security

- **bearerAuth**
