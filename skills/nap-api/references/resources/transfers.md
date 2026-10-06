# transfers

## Operations

| Method | Path | Summary | Details |
|--------|------|---------|----------|
| GET | `/api/transfers` | Workspace transfers waiting on the caller | [View](../operations/get-api-transfers.md) |
| GET | `/api/transfers/{id}` | A transfer, with its plan while it is pending | [View](../operations/get-api-transfers-id.md) |
| POST | `/api/transfers/{id}/accept` | Accept a transfer; the workspace becomes the caller’s | [View](../operations/post-api-transfers-id-accept.md) |
| POST | `/api/transfers/{id}/decline` | Decline a transfer | [View](../operations/post-api-transfers-id-decline.md) |
