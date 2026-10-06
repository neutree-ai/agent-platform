# GET /api/workspaces/{id}/messages/{messageId}/blocks/{ordinal}/image

**Resource:** [workspaces](../resources/workspaces.md)
**Fetch the image bytes of one stored message block**
**Operation ID:** `get--api-workspaces-{id}-messages-{messageId}-blocks-{ordinal}-image`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `messageId` | path | string | Yes |  |
| `ordinal` | path | integer,null | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Image bytes |
| 404 | Workspace, message block, or image not found |

## Security

- **bearerAuth**
