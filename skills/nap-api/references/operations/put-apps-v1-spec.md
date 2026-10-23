# PUT /apps/v1/spec

**Resource:** [apps](../resources/apps.md)
**Apply the application's spec**
**Operation ID:** `put--apps-v1-spec`

The body is the whole spec, as JSON or as YAML (`Content-Type: application/yaml`). References to prompts, skills, providers and environments are resolved now, and a prompt without a version is pinned to its current one. Applying a spec that resolves to the one in force changes nothing. `dry_run` returns the plan only; a spec that drops agents is refused unless `prune` is given, which deletes them.

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `dry_run` | query | enum: true, false | No |  |
| `prune` | query | enum: true, false | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Applied, or planned |
| 400 | Not a valid spec, or a reference does not resolve |
| 409 | The spec drops agents without prune, or declares a taken MCP origin |

**Success Response Schema:**

[AppSpecApplyResult](../schemas/App/AppSpecApplyResult.md)

## Security

- **appClientAuth**
