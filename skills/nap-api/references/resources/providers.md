# providers

Model / inference providers (endpoint + credentials), selectable per workspace; supports test-probe, model listing, and team grants.

## Operations

| Method | Path | Summary | Details |
|--------|------|---------|----------|
| GET | `/api/providers` | List providers visible to the user (own + public + team-shared) | [View](../operations/get-api-providers.md) |
| POST | `/api/providers` | Create a model provider | [View](../operations/post-api-providers.md) |
| PUT | `/api/providers/{id}` | Update a model provider (owner only; empty api_key keeps existing value) | [View](../operations/put-api-providers-id.md) |
| DELETE | `/api/providers/{id}` | Delete a model provider (owner only) | [View](../operations/delete-api-providers-id.md) |
| GET | `/api/providers/{id}/models` | List models available via this provider | [View](../operations/get-api-providers-id-models.md) |
| POST | `/api/providers/{id}/test` | Probe the provider with a minimal request | [View](../operations/post-api-providers-id-test.md) |
| GET | `/api/providers/{id}/grants` | List team grants for a provider (owner only) | [View](../operations/get-api-providers-id-grants.md) |
| PUT | `/api/providers/{id}/grants` | Replace team grants for a provider (owner only) | [View](../operations/put-api-providers-id-grants.md) |
