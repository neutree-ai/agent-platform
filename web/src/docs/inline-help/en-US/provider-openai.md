OpenAI-compatible protocol with the broadest coverage. Besides the official OpenAI API, it also applies to all third-party services that provide OpenAI-compatible endpoints, such as OpenRouter, Azure OpenAI, and various domestic LLM gateways.

- **Base URL**: `https://api.openai.com` or the API endpoint of a third-party service
- **API Key**: The API Key for the corresponding service

## Use cases

- Codex agent (**only this type is supported**)
- OpenRouter free/paid models
- Azure OpenAI deployments
- Other OpenAI-compatible services

## Notes

- OpenRouter free models require adding the `:free` suffix to the model name, such as `stepfun/step-3.5-flash:free`
- Codex agent only supports openai-type Providers

## Visibility

- **Public**: Visible and available to all platform users
- **Private**: Visible only to yourself
