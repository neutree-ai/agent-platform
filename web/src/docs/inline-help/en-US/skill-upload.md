Upload a packaged Skill directory (`.tar.gz` or `.zip`).

## Packaging

<platform-cmd>
macos: |
  COPYFILE_DISABLE=1 tar --exclude='.DS_Store' --exclude='._*' \
    -czf skill.tar.gz -C /path/to/skill-dir .
linux: |
  tar -czf skill.tar.gz -C /path/to/skill-dir .
windows: |
  tar -czf skill.tar.gz -C C:\path\to\skill-dir .
</platform-cmd>

Zipping the folder works too — right-click it and choose Compress (macOS) or
Send to → Compressed folder (Windows). The wrapping folder the archive picks up
is unwrapped on upload, and macOS resource-fork files are discarded.

The directory must contain a `SKILL.md` file as the Skill entry description.

## Field descriptions

- **Name** — Unique identifier name of the Skill
- **Description** — Brief description of what the Skill does
- **Category** — Group in resource library filter chips (optional)
- **Public** — When enabled, visible and available to all platform users; otherwise visible only to yourself

## Example directory structure

```
my-skill/
├── SKILL.md          # Required: skill description and usage instructions
├── prompt.md         # Optional: prompt template
└── resources/        # Optional: supplementary resource files
```
