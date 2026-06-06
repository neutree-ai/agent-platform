# GET /api/skills/sources/{id}/draft/file

**Resource:** [skills](../resources/skills.md)
**Read a single draft file**
**Operation ID:** `get--api-skills-sources-{id}-draft-file`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `path` | query | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | File |
| 404 | Not found |
| 502 | Upstream |

## Security

- **bearerAuth**
