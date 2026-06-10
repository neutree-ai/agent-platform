# GET /api/skills/{id}/dependents

**Resource:** [skills](../resources/skills.md)
**Workspaces / template versions using this skill (owner only)**
**Operation ID:** `get--api-skills-{id}-dependents`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Occupancy preview |
| 403 | Not allowed |
| 404 | Skill not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `own_workspaces` | object[] | Yes |  |
| `other_workspace_count` | number | Yes |  |
| `template_version_count` | number | Yes |  |

**`own_workspaces` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes |  |
| `name` | string | Yes |  |

## Security

- **bearerAuth**
