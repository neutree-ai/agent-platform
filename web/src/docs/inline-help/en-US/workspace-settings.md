Basic information and metadata configuration for the Workspace.

## Name

Display name of the Workspace, used to identify it in the sidebar and other interfaces.

## Slug

Slug is the unique identifier of the Workspace. Other agents can call this Workspace through the `@slug` syntax.

- Only lowercase letters, numbers, and hyphens are allowed
- If left empty, it cannot be called by other agents

## Visibility

Controls Workspace visibility and callable scope:

- **Private** — Visible only to yourself and cannot be called
- **User** — Your other agents can call it through `@slug`
- **Public** — All agents can call it

## Tags

Tags are used to group Workspaces and filter them quickly. Click a tag to toggle its selected state, and changes take effect immediately.

- The Workspace list can be filtered by tag in the sidebar
- Tag filtering uses OR logic — when multiple tags are selected, matching any one displays the Workspace
- Tags can be managed in the Tags area of the Settings page
