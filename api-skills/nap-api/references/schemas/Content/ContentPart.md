# ContentPart

**Type:** object

## Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | enum: text, tool_call, tool_result... | Yes |  |
| `text` | string | No |  |
| `call_id` | string | No |  |
| `name` | string | No |  |
| `arguments` | string | No |  |
| `output` | string | No |  |
| `is_error` | boolean | No |  |
| `label` | string | No |  |
| `detail` | string | No |  |
| `data` | string | No | Base64 payload (image parts). |
| `media_type` | string | No |  |

