## Compute resources

Configure resource limits for the Workspace session. You can choose a preset configuration or customize each value.

### Notes

- Request is the guaranteed allocation and Limit is the upper bound; Request must be less than or equal to Limit
- When cluster resources are insufficient, the session queues and waits for scheduling
- Storage persists across sessions and is not cleared when a session ends

## Concurrency and scaling

Per-replica concurrency is how many turns one replica takes at once; the rest queue. Scheduled runs and interactive chat draw on the same allowance.

An auto-scaling workspace also has replica bounds:

- The minimum is what keeps running while idle; the maximum is the ceiling under load
- Scaling up is immediate; scaling down waits for several consecutive quiet rounds and only removes a replica with no turn running on it
- "Stop when idle" stops the whole workspace, and the next turn starts it again — files live on the shared volume, so nothing is lost
- Single-replica or auto-scaling is fixed when the workspace is created; only the numbers change afterwards
