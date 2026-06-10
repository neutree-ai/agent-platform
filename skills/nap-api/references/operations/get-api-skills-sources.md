# GET /api/skills/sources

**Resource:** [skills](../resources/skills.md)
**List sources owned by the caller**
**Operation ID:** `get--api-skills-sources`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `kind` | query | enum: git, native | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Source list |

**Success Response Schema** (inline):

Array

## Security

- **bearerAuth**
