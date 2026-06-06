Routes direct external events such as Slack messages and Webhook requests to a specified Workspace to execute agent tasks.

## Supported Connector types

### Slack
- Listen for @mention events in channels
- Supports multi-turn conversations (the same thread shares one session)
- Available template variables: `{message}`, `{user}`, `{thread_context}`, `{channel}`

### Webhook
- Receive external HTTP POST requests
- Supports filter rules to filter events
- Available template variables: `{body}`, `{body.field}`, `{query.key}`, `{headers.name}`, `{method}`, `{path}`

After selecting a Connector, the documentation on the right switches to the detailed configuration instructions for that type.
