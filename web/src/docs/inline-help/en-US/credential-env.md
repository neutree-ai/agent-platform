Inject a Credential as an environment variable. When the session starts, the platform writes **Name** as the variable name and **Value** as the variable value into the container environment.

## Common uses

- `GITHUB_TOKEN` — Git private repository cloning and GitHub API calls
- `NPM_TOKEN` — Private npm registry authentication
- `DATABASE_URL` — Database connection string

## Notes

- Name is recommended to use uppercase letters and underscores (`MY_SECRET`)
- A Credential with the same name overwrites the existing value
- Value is encrypted during storage and transmission and does not appear in logs as plaintext
