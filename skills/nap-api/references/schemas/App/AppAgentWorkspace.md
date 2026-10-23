# AppAgentWorkspace

**Type:** object

## Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `agent` | string | Yes |  |
| `workspace_id` | string | Yes |  |
| `status` | string | Yes |  |
| `template_version` | integer | Yes |  |
| `up_to_date` | boolean | Yes | On the agent's latest template version, with its current runtime |
| `blocked` | string,null | Yes | Why the workspace can't follow its agent or have its shared folders, while it can't |

