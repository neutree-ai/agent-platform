Connects to the official OpenAI API, Azure OpenAI, or any gateway that implements the OpenAI **Chat Completions API** — the widely supported OpenAI protocol offered by most gateways.

- **Base URL**: `https://api.openai.com` or the endpoint of a compatible service
- **API Key**: the key for that service

## Requirements

- The endpoint must implement the **Chat Completions API** (`/v1/chat/completions`) — for endpoints that implement the newer Responses API (`/v1/responses`), use **OpenAI Responses** instead

## Notes

- OpenRouter free models require the `:free` suffix on the model name, such as `stepfun/step-3.5-flash:free`

## Visibility

- **Private**: visible only to yourself
- **Team**: shared with the teams you select
- **Public**: visible and available to all platform users
