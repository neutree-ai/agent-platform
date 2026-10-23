# AppSpecApplyResult

**Type:** object

## Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | integer | Yes | The version in force after the apply, or that a dry run would create |
| `hash` | string | Yes |  |
| `changed` | boolean | Yes | False when the spec resolves to the one already in force |
| `plan` | AppSpecPlanEntry[] | Yes |  |

