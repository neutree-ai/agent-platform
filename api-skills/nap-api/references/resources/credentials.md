# credentials

Named secrets stored for the user (values never returned), injected into workspaces — e.g. as env vars or git tokens for skill import.

## Operations

| Method | Path | Summary | Details |
|--------|------|---------|----------|
| GET | `/api/credentials` | List credential metadata for the current user (values are never returned) | [View](../operations/get-api-credentials.md) |
| PUT | `/api/credentials/{name}` | Upsert a credential. For env injection the name must be a valid env var identifier. | [View](../operations/put-api-credentials-name.md) |
| DELETE | `/api/credentials/{name}` | Soft-delete a credential, then hard-delete once all running workspaces reloaded | [View](../operations/delete-api-credentials-name.md) |
