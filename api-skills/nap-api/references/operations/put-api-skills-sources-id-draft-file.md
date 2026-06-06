# PUT /api/skills/sources/{id}/draft/file

**Resource:** [skills](../resources/skills.md)
**Write a single draft file**
**Operation ID:** `put--api-skills-sources-{id}-draft-file`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `path` | query | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Saved |
| 400 | Bad path or empty body |
| 404 | Source not found |
| 413 | Too large |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `ok` | enum: true | Yes |  |
| `byte_count` | number | Yes |  |

## Security

- **bearerAuth**
