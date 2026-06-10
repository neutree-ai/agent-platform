# GET /api/skills/{id}/dirs

**Resource:** [skills](../resources/skills.md)
**List directory entries inside a skill package (visibility-gated)**
**Operation ID:** `get--api-skills-{id}-dirs`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `path` | query | string | No |  |
| `q` | query | string | No |  |
| `version` | query | string | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Directory entries |
| 404 | Skill or directory not found |
| 502 | Upstream unavailable |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `entries` | any[] | Yes |  |

## Security

- **bearerAuth**
