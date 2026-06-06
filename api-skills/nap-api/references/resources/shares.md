# shares

Public **session** shares — snapshot a chat session's messages/config into a publicly viewable link. Unrelated to `afs` (which shares folders).

## Operations

| Method | Path | Summary | Details |
|--------|------|---------|----------|
| GET | `/api/shares` | List shares created for a given workspace session | [View](../operations/get-api-shares.md) |
| POST | `/api/shares` | Create a share by snapshotting session messages, config and trigger | [View](../operations/post-api-shares.md) |
| DELETE | `/api/shares/{id}` | Delete a share (owner only) | [View](../operations/delete-api-shares-id.md) |
| PATCH | `/api/shares/{id}` | Update a share title (owner only) | [View](../operations/patch-api-shares-id.md) |
| GET | `/api/shares/public/{id}` | Public share view (no authentication required) | [View](../operations/get-api-shares-public-id.md) |
