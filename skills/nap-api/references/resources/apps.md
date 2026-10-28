# apps

## Operations

| Method | Path | Summary | Details |
|--------|------|---------|----------|
| PUT | `/apps/v1/users/{external_id}` | Provision a user of the application, or update its name and email | [View](../operations/put-apps-v1-users-external-id.md) |
| DELETE | `/apps/v1/users/{external_id}` | Delete a user of the application | [View](../operations/delete-apps-v1-users-external-id.md) |
| POST | `/apps/v1/users/{external_id}/token` | Obtain a short-lived access token for a user of the application | [View](../operations/post-apps-v1-users-external-id-token.md) |
| GET | `/apps/v1/teams` | List the application's teams | [View](../operations/get-apps-v1-teams.md) |
| PUT | `/apps/v1/teams/{external_id}` | Create a team of the application, or update its name and description | [View](../operations/put-apps-v1-teams-external-id.md) |
| DELETE | `/apps/v1/teams/{external_id}` | Delete a team of the application | [View](../operations/delete-apps-v1-teams-external-id.md) |
| GET | `/apps/v1/teams/{external_id}/members` | List the members of a team of the application | [View](../operations/get-apps-v1-teams-external-id-members.md) |
| PUT | `/apps/v1/teams/{external_id}/members/{user_external_id}` | Add a user of the application to one of its teams | [View](../operations/put-apps-v1-teams-external-id-members-user-external-id.md) |
| DELETE | `/apps/v1/teams/{external_id}/members/{user_external_id}` | Remove a user from a team of the application | [View](../operations/delete-apps-v1-teams-external-id-members-user-external-id.md) |
| GET | `/apps/v1/prompts` | List the application's prompts | [View](../operations/get-apps-v1-prompts.md) |
| PUT | `/apps/v1/prompts/{name}` | Publish a prompt | [View](../operations/put-apps-v1-prompts-name.md) |
| DELETE | `/apps/v1/prompts/{name}` | Delete a prompt | [View](../operations/delete-apps-v1-prompts-name.md) |
| GET | `/apps/v1/skills` | List the application's skills | [View](../operations/get-apps-v1-skills.md) |
| PUT | `/apps/v1/skills/{name}` | Publish a skill | [View](../operations/put-apps-v1-skills-name.md) |
| DELETE | `/apps/v1/skills/{name}` | Delete a skill | [View](../operations/delete-apps-v1-skills-name.md) |
| GET | `/apps/v1/spec` | Get the application's spec in force | [View](../operations/get-apps-v1-spec.md) |
| PUT | `/apps/v1/spec` | Apply the application's spec | [View](../operations/put-apps-v1-spec.md) |
| GET | `/apps/v1/spec/status` | How far the users' workspaces have followed the spec | [View](../operations/get-apps-v1-spec-status.md) |
| GET | `/apps/v1/users/{external_id}/agents` | List the user's agent workspaces | [View](../operations/get-apps-v1-users-external-id-agents.md) |
| PUT | `/apps/v1/users/{external_id}/agents/{agent}` | Ensure the user's workspace for an agent | [View](../operations/put-apps-v1-users-external-id-agents-agent.md) |
| DELETE | `/apps/v1/users/{external_id}/agents/{agent}` | Delete the user's workspace for an agent | [View](../operations/delete-apps-v1-users-external-id-agents-agent.md) |
