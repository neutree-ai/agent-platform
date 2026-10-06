# environments

## Operations

| Method | Path | Summary | Details |
|--------|------|---------|----------|
| GET | `/api/environments` | List environments visible to the user (own + public + team-shared) | [View](../operations/get-api-environments.md) |
| POST | `/api/environments` | Register a remote environment | [View](../operations/post-api-environments.md) |
| GET | `/api/environments/{id}` | Get an environment the user can access | [View](../operations/get-api-environments-id.md) |
| PUT | `/api/environments/{id}` | Update a remote environment (owner only) | [View](../operations/put-api-environments-id.md) |
| DELETE | `/api/environments/{id}` | Delete a remote environment (owner only) | [View](../operations/delete-api-environments-id.md) |
| GET | `/api/environments/{id}/grants` | List team grants (owner only) | [View](../operations/get-api-environments-id-grants.md) |
| PUT | `/api/environments/{id}/grants` | Replace team grants (owner only) | [View](../operations/put-api-environments-id-grants.md) |
| GET | `/api/environments/{id}/tokens` | List active runner tokens (owner only) | [View](../operations/get-api-environments-id-tokens.md) |
| POST | `/api/environments/{id}/tokens` | Issue a runner token for an environment (owner only) | [View](../operations/post-api-environments-id-tokens.md) |
| DELETE | `/api/environments/{id}/tokens/{tokenId}` | Revoke a runner token (owner only) | [View](../operations/delete-api-environments-id-tokens-tokenId.md) |
