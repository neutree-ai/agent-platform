Connects to the official OpenAI API, Azure OpenAI, or any gateway that implements the OpenAI **Responses API**.

- **Base URL**: `https://api.openai.com` or the endpoint of a compatible service
- **API Key**: the key for that service

## Requirements

- The endpoint must implement the **Responses API** (`/v1/responses`) — services that only offer Chat Completions (`/v1/chat/completions`) do **not** work with this type; use **OpenAI Chat Completions** for those

## Visibility

- **Private**: visible only to yourself
- **Team**: shared with the teams you select
- **Public**: visible and available to all platform users
