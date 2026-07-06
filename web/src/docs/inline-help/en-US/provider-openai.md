The provider type for the Codex agent. Connects to the official OpenAI API, Azure OpenAI, or a gateway that implements the OpenAI protocol.

- **Base URL**: `https://api.openai.com` or the endpoint of a compatible service
- **API Key**: the key for that service

## Requirements

- Codex talks the **Responses API** (`/v1/responses`), so the endpoint must implement it — services that only offer Chat Completions (`/v1/chat/completions`) do **not** work
- Codex agents can only use this provider type; Claude Code agents use the Anthropic types instead

## Notes

- OpenRouter free models require the `:free` suffix on the model name, such as `stepfun/step-3.5-flash:free`

## Visibility

- **Private**: visible only to yourself
- **Team**: shared with the teams you select
- **Public**: visible and available to all platform users
