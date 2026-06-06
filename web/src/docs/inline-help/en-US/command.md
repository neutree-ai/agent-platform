Custom commands can package frequently used instructions as shortcuts. Type `/` in the chat input to trigger them.

## Command types

- **Plain** — Fixed text that is sent directly to the agent after triggering
- **Struct** — A template containing `{{variables}}` placeholders; a form opens on trigger for the user to fill in

## Struct template syntax

Use double braces to define variables:

```
Check the {{FILE_PATH}} file on the {{BRANCH}} branch of project {{PROJECT_ID}}
```

When triggered, a form opens with three input fields: `PROJECT_ID`, `BRANCH`, and `FILE_PATH`.

Variable names are recommended to use uppercase letters and underscores.

## Content source

- **Custom** — Edit the content directly here
- **Prompt Library** — Link to an entry in the prompt library; content is automatically synchronized as the prompt updates

## Notes

- Command names cannot conflict with built-in commands
- After linking a Prompt, the content is managed by the prompt library and is read-only here
