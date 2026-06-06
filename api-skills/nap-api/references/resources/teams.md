# teams

Teams and membership — the basis for team-scoped sharing / grants on skills, prompts, and providers.

## Operations

| Method | Path | Summary | Details |
|--------|------|---------|----------|
| GET | `/api/teams` | List teams the current user is a member of | [View](../operations/get-api-teams.md) |
| POST | `/api/teams` | Create a team. The creator becomes its first admin. | [View](../operations/post-api-teams.md) |
| GET | `/api/teams/{id}` | Get team detail (members only) | [View](../operations/get-api-teams-id.md) |
| DELETE | `/api/teams/{id}` | Delete a team (admin only). Cascades to team_members and grants. | [View](../operations/delete-api-teams-id.md) |
| PATCH | `/api/teams/{id}` | Update team name/description (admin only) | [View](../operations/patch-api-teams-id.md) |
| GET | `/api/teams/{id}/members` | List team members (members only) | [View](../operations/get-api-teams-id-members.md) |
| POST | `/api/teams/{id}/members` | Add a user to the team (admin only) | [View](../operations/post-api-teams-id-members.md) |
| DELETE | `/api/teams/{id}/members/{userId}` | Remove a member. Admins can remove anyone; users can remove themselves. | [View](../operations/delete-api-teams-id-members-userId.md) |
| PATCH | `/api/teams/{id}/members/{userId}` | Change a member's role (admin only) | [View](../operations/patch-api-teams-id-members-userId.md) |
| GET | `/api/teams/{id}/invites` | List active (non-expired) invite links for a team (admin only) | [View](../operations/get-api-teams-id-invites.md) |
| POST | `/api/teams/{id}/invites` | Create an invite link (admin only). Default expiry 7 days. | [View](../operations/post-api-teams-id-invites.md) |
| DELETE | `/api/teams/{id}/invites/{token}` | Revoke an invite link (admin only) | [View](../operations/delete-api-teams-id-invites-token.md) |
