# ItemDeltaEvent

**Type:** object

## Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | enum: item.delta | Yes |  |
| `session_id` | string | No |  |
| `item_id` | string | Yes |  |
| `delta` | [ContentDelta](ContentDelta.md) | Yes |  |
| `timestamp` | number | Yes | Epoch milliseconds. |

