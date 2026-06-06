## Browser session

Spin up a remote browser instance inside the sandbox.

- **Create / renew / destroy** is managed via MCP (lifecycle only)
- **Control** is driven by the agent using the `agent-browser` CLI, Playwright, etc.
- **Live view** is embedded in this panel — take it over manually whenever needed (captchas, sign-in, ...)

### Session timeout

Sessions are reclaimed automatically when they expire. Use the `+1h` button in the header to extend a live session.

| Option | When to use |
|--------|-------------|
| 10 min | One-shot scrape |
| 1 hour | Multi-step work inside one session (default) |
| 6 hours / 24 hours | Reused across chats |
