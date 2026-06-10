# GET /api/skills/sources/{id}/draft/files

**Resource:** [skills](../resources/skills.md)
**List the source draft scratch tree**
**Operation ID:** `get--api-skills-sources-{id}-draft-files`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Tree |
| 404 | Source not found / not writable |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `entries` | object[] | Yes |  |

**`entries` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | string | Yes |  |
| `type` | enum: file, dir | Yes |  |
| `size` | number | No |  |

## Security

- **bearerAuth**
