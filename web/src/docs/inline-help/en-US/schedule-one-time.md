One-time scheduled tasks trigger once at the specified time, are automatically marked as **completed** after triggering, do not trigger again, and do not require manual cleanup.

Suitable for **one-off** needs such as "help me organize a report in 3 days" or "run QA once before next Monday's release"; you do not need to construct a cron expression or manually delete the task after execution.

## Fields

- **Name** — Task name, used for list display and log identification
- **Execution time** — The specific trigger time, which must be in the future
- **Timezone** — Only used as a display marker; the exact trigger instant is already determined by the selected time
- **Prompt** — The instruction content sent to the agent at trigger time; you can enter text directly or reference a template from the prompt library

## Notes

- Completed one-time tasks remain in the list as history and cannot be enabled or edited again; to run it again, create a new one directly
- **Disabling** an untriggered one-time task is equivalent to canceling that trigger; after re-enabling, it continues waiting according to the original time, and past times are not backfilled
- You can also use natural language in an agent conversation to ask the agent to create, modify, or delete one-time tasks for you
