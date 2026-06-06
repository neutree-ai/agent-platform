# PUT /api/tags/{id}

**Resource:** [tags](../resources/tags.md)
**Update a tag**
**Operation ID:** `put--api-tags-{id}`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | No |  |
| `color` | enum: slate, rose, amber... | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Updated tag |
| 404 | Tag not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes |  |
| `name` | string | Yes |  |
| `color` | string | Yes |  |
| `created_at` | string | Yes |  |

## Security

- **bearerAuth**
