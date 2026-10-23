# PUT /apps/v1/skills/{name}

**Resource:** [apps](../resources/apps.md)
**Publish a skill**
**Operation ID:** `put--apps-v1-skills-{name}`

The body is the skill package, a .tar.gz or .zip with SKILL.md at its root; the description defaults to the one SKILL.md gives. Creates the skill, or makes the package its active version. Package bytes decide whether it is new: build the archive reproducibly so the same files publish as the same version.

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `name` | path | string | Yes | The application's own name for it |
| `description` | query | string | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | The skill already existed |
| 201 | The skill was created |
| 400 | Not a skill package |
| 413 | Package exceeds the size limit |

**Success Response Schema:**

[AppSkill](../schemas/App/AppSkill.md)

## Security

- **appClientAuth**
