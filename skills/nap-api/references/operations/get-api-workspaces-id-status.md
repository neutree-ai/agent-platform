# GET /api/workspaces/{id}/status

**Resource:** [workspaces](../resources/workspaces.md)
**Get workspace runtime (K8s) status**
**Operation ID:** `get--api-workspaces-{id}-status`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Current K8s deployment, service, and pod status |
| 404 | Workspace not found |
| 500 | Failed to query K8s |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `deployment` | object,null | Yes |  |
| `service` | object,null | Yes |  |
| `pods` | object,null | Yes |  |
| `warnings` | object[] | Yes |  |
| `conditions` | object[] | Yes |  |

**`warnings` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `reason` | string | Yes |  |
| `message` | string | Yes |  |

**`conditions` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes |  |
| `status` | boolean | Yes |  |
| `message` | string | No |  |

## Security

- **bearerAuth**
