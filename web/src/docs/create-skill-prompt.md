Create a skill named "{{SKILL_NAME}}".

Requirements:
{{DESCRIPTION}}

## NAP Platform Workflow

This workspace has skill management MCP tools. Use them for the lifecycle:

1. **Create draft**: Call `skill_create_draft` with the skill name. It returns the skill directory path. This enters edit mode automatically.
2. **Write content**: Use your file tools to edit SKILL.md and create any scripts/references/assets in the skill directory. Follow the `skill-creator` skill for best practices on writing effective skills.
3. **Publish**: When ready, call `skill_publish` to package and enable the skill for this workspace.

To edit an existing skill later, call `skill_enter_edit` first, make changes, then `skill_publish` again.
