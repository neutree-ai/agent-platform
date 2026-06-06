Recurring scheduled tasks trigger repeatedly according to a cron expression. Each trigger creates a new session in the Workspace and executes the instructions in **Prompt**.

## Cron expression

Standard five-field format: `minute hour day month weekday`

| Example | Meaning |
|------|------|
| `0 9 * * *` | Every day at 9:00 |
| `0 9 * * 1-5` | Weekdays at 9:00 |
| `*/30 * * * *` | Every 30 minutes |
| `0 0 1 * *` | At 0:00 on the 1st day of each month |

## Fields

- **Name** — Task name, used for list display and log identification
- **Cron** — Trigger cadence
- **Timezone** — Timezone basis for the cron expression, defaulting to the browser timezone
- **Prompt** — The instruction content sent to the agent on each trigger; you can enter text directly or reference a template from the prompt library

## Notes

- After disabling, it no longer triggers but keeps the configuration
- Each trigger is an independent session and does not share context
- The minimum interval is recommended to be no less than 5 minutes
- You can also ask the agent in a conversation to create, modify, or delete recurring tasks for you
