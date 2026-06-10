# PUT /api/skills/sources/{id}/draft

**Resource:** [skills](../resources/skills.md)
**Save the native source draft (tar.gz body)**
**Operation ID:** `put--api-skills-sources-{id}-draft`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Draft stored |
| 400 | Empty body or non-native source |
| 404 | Source not found |
| 413 | Draft exceeds size limit |
| 502 | skills-content-service unavailable |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `ok` | enum: true | Yes |  |
| `byte_count` | number | Yes |  |

## Security

- **bearerAuth**
