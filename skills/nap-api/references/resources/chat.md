# chat

Drive a workspace's agent with a natural-language prompt — the primary way to get work done inside a workspace (the agent has bash + file tools). Supports synchronous and async (`mode: async`) modes; for async, poll the session for completion.

## Operations

| Method | Path | Summary | Details |
|--------|------|---------|----------|
| POST | `/api/workspaces/{id}/chat` | Start (or continue) a chat turn with a workspace agent | [View](../operations/post-api-workspaces-id-chat.md) |
