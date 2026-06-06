# PUT /api/tags/workspace/{workspaceId}

**Resource:** [tags](../resources/tags.md)
**Replace the tag set applied to a workspace**
**Operation ID:** `put--api-tags-workspace-{workspaceId}`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `workspaceId` | path | string | Yes |  |

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tag_ids` | string[] | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Applied |
| 404 | Workspace not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | boolean | Yes |  |

## Security

- **bearerAuth**
