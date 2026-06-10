# SessionEndedEvent

**Type:** object

## Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | enum: session.ended | Yes |  |
| `session_id` | string | No |  |
| `reason` | enum: completed, error, interrupted | Yes |  |
| `stats` | [TurnStats](TurnStats.md) | No |  |
| `timestamp` | number | Yes | Epoch milliseconds. |

