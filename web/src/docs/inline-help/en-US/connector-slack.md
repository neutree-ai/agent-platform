Connect a Slack Workspace so the platform can receive Slack events (e.g. @mentions) in real time via Socket Mode.

## Required Credentials

- **Bot Token** (`xoxb-...`) — Slack App → OAuth & Permissions → Bot User OAuth Token
- **App Token** (`xapp-...`) — Slack App → Basic Information → App-Level Tokens, requires the `connections:write` scope

## Creating a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and create a new App
2. Enable **Socket Mode**
3. Under **OAuth & Permissions**, add Bot Token Scopes: `chat:write`, `channels:history`, `channels:read`, `app_mentions:read`
4. Under **Basic Information**, create an App-Level Token (scope: `connections:write`)
5. Install the App to your Workspace

## Next Steps

After the Connector is created, configure a **Route** for each Channel to define:
- Which Channel to listen on (Channel ID)
- Which Workspace to trigger for task execution
- How to convert a message into a prompt (template)

## Testing

After creation, the platform automatically tests the connection to verify that the tokens are valid.
