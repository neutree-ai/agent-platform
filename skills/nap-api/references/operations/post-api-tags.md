# POST /api/tags

**Resource:** [tags](../resources/tags.md)
**Create a tag**
**Operation ID:** `post--api-tags`

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes |  |
| `color` | enum: slate, rose, amber... | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 201 | Created tag |
| 409 | Name already in use |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes |  |
| `name` | string | Yes |  |
| `color` | string | Yes |  |
| `created_at` | string | Yes |  |

## Security

- **bearerAuth**
