# AppSpecStatus

**Type:** object

## Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | integer,null | Yes |  |
| `agents` | object[] | Yes |  |

## Nested Fields

### `agents`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `agent` | string | Yes |  |
| `template_version` | integer | Yes |  |
| `workspaces` | integer | Yes |  |
| `up_to_date` | integer | Yes |  |
| `blocked` | integer | Yes | Workspaces that can't follow the agent; see each user's agents |

