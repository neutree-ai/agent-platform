# prompts

Reusable prompt templates owned by the user, attachable to a workspace's config.

## Operations

| Method | Path | Summary | Details |
|--------|------|---------|----------|
| GET | `/api/prompts` | List prompts visible to the user (own + public + team-shared) | [View](../operations/get-api-prompts.md) |
| POST | `/api/prompts` | Create a prompt | [View](../operations/post-api-prompts.md) |
| GET | `/api/prompts/public` | List public prompts | [View](../operations/get-api-prompts-public.md) |
| GET | `/api/prompts/{id}` | Get a prompt (visibility-aware) | [View](../operations/get-api-prompts-id.md) |
| PUT | `/api/prompts/{id}` | Update a prompt. Owner can change anything; editors can change name/content. Reloads running workspaces. | [View](../operations/put-api-prompts-id.md) |
| DELETE | `/api/prompts/{id}` | Delete a prompt (owner only) | [View](../operations/delete-api-prompts-id.md) |
| GET | `/api/prompts/{id}/versions` | List prompt versions (visibility-aware) | [View](../operations/get-api-prompts-id-versions.md) |
| POST | `/api/prompts/{id}/rollback` | Roll back to an earlier version (owner or editor) | [View](../operations/post-api-prompts-id-rollback.md) |
| GET | `/api/prompts/{id}/grants` | List team grants for a prompt (owner only) | [View](../operations/get-api-prompts-id-grants.md) |
| PUT | `/api/prompts/{id}/grants` | Replace team grants for a prompt (owner only) | [View](../operations/put-api-prompts-id-grants.md) |
