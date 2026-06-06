# TurnStats

**Type:** object

## Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `costUsd` | number | Yes |  |
| `durationMs` | number | Yes |  |
| `numTurns` | number | Yes |  |
| `inputTokens` | number | Yes |  |
| `outputTokens` | number | Yes |  |
| `cacheReadTokens` | number | Yes |  |
| `cacheCreationTokens` | number | Yes |  |
| `contextTokens` | number | Yes | Last API call's input_tokens ≈ current context size. |
| `contextWindow` | number | Yes | Model's context window limit. |

