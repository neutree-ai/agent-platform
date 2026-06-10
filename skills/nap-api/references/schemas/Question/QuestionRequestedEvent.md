# QuestionRequestedEvent

**Type:** object

## Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | enum: question.requested | Yes |  |
| `session_id` | string | No |  |
| `request_id` | string | Yes |  |
| `questions` | any[] | Yes | Agent-specific question payloads; shape depends on the agent. |
| `timestamp` | number | Yes | Epoch milliseconds. |

