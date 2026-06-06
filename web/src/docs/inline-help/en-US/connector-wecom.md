Connect to WeCom to receive group chat @Bot messages in real-time through a Smart Bot WebSocket connection.

## Required Credentials

- **Bot ID** (`aibXXX...`) — The unique identifier of the Smart Bot
- **Secret** — The WebSocket connection secret for the Smart Bot (note: this is not the corpsecret of a custom application)

## Creating a Smart Bot

1. Log in to the WeCom Admin Console
2. Navigate to **Security & Management → Management Tools → Smart Bot**
3. Create a bot and select **API Mode**
4. Record the Bot ID and Secret
5. Add the bot to the target group chat (group must have at least 3 members)

## Next Steps

After the Connector is created, you need to create a **Route** for each specific group chat to define:
- Which group to listen to (group chat ID)
- Which Workspace to trigger for task execution
- How to convert messages into prompts (template)

## Important Notes

- The passive reply window is 24 hours, and each message's req_id can only be replied to once
- Rate limits: 30 messages/minute, 1000 messages/hour
- WeCom has no native threading; the platform automatically manages conversations through time windows
