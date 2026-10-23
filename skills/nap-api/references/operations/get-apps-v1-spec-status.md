# GET /apps/v1/spec/status

**Resource:** [apps](../resources/apps.md)
**How far the users' workspaces have followed the spec**
**Operation ID:** `get--apps-v1-spec-status`

Per agent: its template version, and how many of its workspaces are on it with the agent's current runtime. A workspace takes a change once no turn is running in it.

## Responses

| Status | Description |
|--------|-------------|
| 200 | Status |

**Success Response Schema:**

[AppSpecStatus](../schemas/App/AppSpecStatus.md)

## Security

- **appClientAuth**
