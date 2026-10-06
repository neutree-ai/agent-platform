# GET /api/workspaces/{id}/runtime-timeline

**Resource:** [workspaces](../resources/workspaces.md)
**A workspace's runtime state as timeline segments over the last `days` days — what it was, for how long, and at which spec.**
**Operation ID:** `get--api-workspaces-{id}-runtime-timeline`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `days` | query | integer | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Runtime timeline |
| 404 | Workspace not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `segments` | object[] | Yes |  |

**`segments` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `startedAt` | string | Yes |  |
| `endedAt` | string | Yes |  |
| `phase` | string | Yes |  |
| `replicas` | integer | Yes |  |
| `coreRequest` | number | Yes |  |
| `storageGib` | number | Yes |  |
| `specVersion` | integer,null | Yes |  |

## Security

- **bearerAuth**
