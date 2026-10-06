# GET /api/workspaces/{id}/runtime-timeline

**Resource:** [workspaces](../resources/workspaces.md)
**A workspace's runtime state as timeline segments — what it was, for how long, and at which spec.**
**Operation ID:** `get--api-workspaces-{id}-runtime-timeline`

Covers the last `days` days, or `[since, until)` when `since` is given. Segments are clipped to the window. A segment that is not `ongoing` never changes, so incremental readers pass the instant they last read through as `since`. A stopped or scaled-to-zero workspace keeps a segment with `replicas: 0` and its storage. A deleted workspace stays readable by its last owner; its timeline ends at the deletion.

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `days` | query | integer | No |  |
| `since` | query | string (date-time) | No | Start of the window (ISO 8601). When set, `days` is ignored and segments are clipped to `[since, until)`. |
| `until` | query | string (date-time) | No | End of the window (ISO 8601). Requires `since`; defaults to now. |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Runtime timeline |
| 400 | Invalid window |
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
| `memoryGib` | number | Yes |  |
| `storageGib` | number | Yes |  |
| `specVersion` | integer,null | Yes |  |
| `ongoing` | boolean | Yes |  |

## Security

- **bearerAuth**
