Route @Bot messages in WeCom group chats to a specified Workspace for execution.

## Field descriptions

- **Connector** — Select a created WeCom Connector
- **Group chat ID** — WeCom group chat ID (format `wrXXX...`), available from the `chatid` field in test script logs
- **Workspace** — Which Workspace executes the task after the event is triggered

## Prompt template

Define how to convert WeCom messages into agent prompts. Available variables:

| Variable | Description |
|------|------|
| `{message}` | Message text sent by the user |
| `{user}` | Sender's WeCom UserID (aibot callbacks only deliver userid, with no name/email) |
| `{channel}` | Group chat ID; for single chats, the synthesized `user:<userid>` |
| `{chat_type}` | `single` (single chat) or `group` (group chat) |

If left empty, the original message is used directly. You can also select from the Prompt library.

## Session TTL

Because WeCom has no native thread, the platform automatically manages sessions through group chat ID + time window. Messages in the same group share one session within the TTL time window. The default is 24 hours.
