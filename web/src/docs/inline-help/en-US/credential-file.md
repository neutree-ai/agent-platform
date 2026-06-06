Inject a Credential as a file. When the session starts, the platform writes **Value** to the specified **File path** and sets the corresponding **File mode** (permissions).

## Common uses

- Certificate files (`.pem`, `.crt`)
- Configuration files (`~/.gitconfig`)
- Service account JSON (`credentials.json`)

## Field descriptions

- **File path** — Target path in the container; supports expanding `~` to the user's home directory
- **File mode** — Unix file permissions:
  - `0600` Private — Readable and writable only by the owner (recommended for secrets)
  - `0400` Read-only — Read-only for the owner
  - `0644` Shared — Readable by everyone
  - `0755` Executable — Readable and executable by everyone (scripts)

## Notes

- Directories in the path are created automatically
- A newline is automatically appended to the end of the file
- A Credential with the same name overwrites the existing value
