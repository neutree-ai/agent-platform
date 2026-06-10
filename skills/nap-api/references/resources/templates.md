# templates

Workspace templates — snapshot a workspace's commands / schedules / layout into a distributable template and instantiate new workspaces from one.

## Operations

| Method | Path | Summary | Details |
|--------|------|---------|----------|
| GET | `/api/templates` | List templates visible to the user (own + public + team-shared) | [View](../operations/get-api-templates.md) |
| POST | `/api/templates` | Create a template | [View](../operations/post-api-templates.md) |
| GET | `/api/templates/{id}` | Get a template by id (visibility-aware) | [View](../operations/get-api-templates-id.md) |
| PUT | `/api/templates/{id}` | Update template metadata. Owner: anything. Editor: name/description only. | [View](../operations/put-api-templates-id.md) |
| DELETE | `/api/templates/{id}` | Delete a template (owner only) | [View](../operations/delete-api-templates-id.md) |
| GET | `/api/templates/{id}/versions` | List versions of a template | [View](../operations/get-api-templates-id-versions.md) |
| POST | `/api/templates/{id}/versions` | Create a new version of a template (owner or editor) | [View](../operations/post-api-templates-id-versions.md) |
| GET | `/api/templates/{id}/versions/{version}` | Get a specific version of a template | [View](../operations/get-api-templates-id-versions-version.md) |
| GET | `/api/templates/{id}/usage` | List workspaces (owned by the current user) that reference this template | [View](../operations/get-api-templates-id-usage.md) |
| GET | `/api/templates/{id}/grants` | List team grants for a template (owner only) | [View](../operations/get-api-templates-id-grants.md) |
| PUT | `/api/templates/{id}/grants` | Replace team grants for a template (owner only) | [View](../operations/put-api-templates-id-grants.md) |
