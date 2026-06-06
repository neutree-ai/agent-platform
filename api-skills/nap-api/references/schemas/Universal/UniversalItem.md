# UniversalItem

**Type:** object

## Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `item_id` | string | Yes |  |
| `kind` | enum: message, tool_call, tool_result... | Yes |  |
| `role` | enum: user, assistant, tool... | Yes |  |
| `status` | enum: in_progress, completed, failed | Yes |  |
| `content` | ContentPart[] | Yes |  |
| `parent_tool_use_id` | string,null | No | If produced inside a sub-agent, the tool_use_id of the Agent call that spawned it. |

