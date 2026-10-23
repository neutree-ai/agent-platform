# GET /apps/v1/spec

**Resource:** [apps](../resources/apps.md)
**Get the application's spec in force**
**Operation ID:** `get--apps-v1-spec`

The spec as locked: each prompt reference carries the version it resolved to. With `Accept: application/yaml` the body is the spec alone, in YAML.

## Responses

| Status | Description |
|--------|-------------|
| 200 | The spec in force |
| 404 | No spec applied yet |

**Success Response Schema:**

[AppSpecCurrent](../schemas/App/AppSpecCurrent.md)

## Security

- **appClientAuth**
