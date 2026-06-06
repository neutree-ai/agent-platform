Route @mention events in a Slack Channel to a specified Workspace for execution.

## Field descriptions

- **Connector** — Select a created Slack Connector
- **Channel** — Select a Channel the bot has joined (only channels where the bot is present are listed)
- **Workspace** — Which Workspace executes the task after the event is triggered

## Prompt template

Define how to convert a Slack message into an agent prompt. Available variables:

| Variable | Description |
|------|------|
| `{message}` | Message text sent by the user |
| `{user}` | Slack User ID of the sender |
| `{thread_context}` | Historical messages in the same thread |
| `{thread_ts}` | Thread timestamp |
| `{channel}` | Channel ID |

If left empty, the original message is used directly. You can also select from the Prompt library.

## Session TTL

Messages in the same thread share one session within the TTL time window, enabling multi-turn conversations. The default is 24 hours.
