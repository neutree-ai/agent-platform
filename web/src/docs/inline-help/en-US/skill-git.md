Import a Skill from a Git repository. The platform automatically clones the repository and extracts the Skill content.

## URL format

- `https://github.com/owner/repo` — Import the entire repository
- `owner/repo` — GitHub shorthand
- `https://github.com/owner/repo/tree/branch/subpath` — Import a subdirectory on a specified branch
- Supports GitHub, GitLab, and self-hosted Git services

## Access token

Private repositories require an access token:

- **None** — Public repositories do not require a token
- **Credential** — Select from configured Credentials (only env type is listed)
- **Manual** — Enter the token directly

## Auto-detection

- **Name** and **Description** are automatically extracted from `SKILL.md` frontmatter and can also be overridden manually
- If the repository does not contain `SKILL.md`, the repository name is used as the Skill name
