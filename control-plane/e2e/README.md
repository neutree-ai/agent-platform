# Control-plane end-to-end suite

These tests drive a **deployed** control plane over HTTP. They do not spawn a
server, do not connect to a database, and do not run migrations — the thing
under test is a real installation, including the reconciler that brings
workspaces up and the agent containers that call back into the control plane.

That last part is why the suite works this way. Sessions, shares and jobs were
unrunnable for as long as the harness started its own control plane on a local
port: agent containers had no route back to it. Pointing at a real deployment
removes the problem instead of working around it.

## Running

```bash
cp e2e/profile.example.json e2e/profile.local.json   # gitignored
$EDITOR e2e/profile.local.json                        # target, admin, LLM
E2E_PROFILE=./e2e/profile.local.json npm run test:e2e
```

Any profile field can come from the environment instead, so CI never needs the
file: `E2E_BASE_URL`, `E2E_ADMIN_USERNAME`, `E2E_ADMIN_PASSWORD`,
`E2E_LLM_BASE_URL`, `E2E_LLM_API_KEY`, `E2E_LLM_MODEL`, `E2E_LLM_PROVIDER_TYPE`.

Filter as usual: `npm run test:e2e -- e2e/workspaces.test.ts -t 'start'`.

`npm test` runs unit tests only. The e2e suite has its own Vitest config so a
bare `vitest` can never reach a cluster by accident.

## What it does to the target

Each run creates a throwaway user, mints it a service token, and drives every
spec as that user. Nothing pre-existing is read or modified — no shared
credential is overwritten, no real account's default prompt is cleared.

Teardown releases the run's workspaces through the API (so Kubernetes resources
are reclaimed rather than orphaned) and then deletes the user. `users` has no
`ON DELETE CASCADE` for workspaces, providers, skills, shares or schedules, so
that final delete only succeeds if the run really did clean up after itself —
a failure there is reported as a leak rather than swallowed.

Two guards stand in front of all of this:

- `confirmMutatesTarget` must be `true`. There is no default that lets an
  unconfigured run mutate a cluster.
- The run aborts if the target already has user accounts beyond the admin,
  since that suggests a deployment somebody is using. Override with
  `allowNonPristineTarget` when pointing at a shared dev cluster on purpose.

## When something fails

Before cleaning up, the harness writes `<artifactsDir>/<runId>/` with the run's
workspaces, their sessions, and — if `KUBECONFIG` and `E2E_K8S_NAMESPACE` are
set — pod, deployment and event listings.

Set `E2E_KEEP_ON_FAILURE=1` to skip cleanup entirely and inspect the target
live. The next run will refuse to start until the leftover user is removed.

## Capabilities

`capabilities` in the profile describes what the deployment actually has.
Turning one off skips the specs that need it rather than failing them:

| Capability   | Gates                                              |
| ------------ | -------------------------------------------------- |
| `kubernetes` | workspace lifecycle, and everything needing a live agent (sessions, shares, jobs) |
| `sandbox`    | reserved for sandbox coverage                      |
| `browser`    | reserved for browser coverage                      |

## Agent core matrix

`llm.agentTypes` decides how wide the run is. Every spec that drives a live
agent — sessions, shares, jobs — runs once per entry, each with its own
workspace and provider, so adding a core widens coverage without touching a
spec:

```json
"agentTypes": ["goose"]                       // one pass
"agentTypes": ["goose", "claude-code"]        // two passes each
```

Each core must both ship with the deployment and speak the configured
endpoint's protocol — an OpenAI-compatible endpoint needs a core on the OpenAI
chat path. Specs that only round-trip configuration (templates, workspace
lifecycle) use the first entry rather than multiplying.

## Conversation tests use a real model

There is no stubbed provider. Whether a deployed agent can reach a configured
model endpoint and return a reply is exactly what a release needs to prove, so
the profile points at a real OpenAI-compatible endpoint and the tests talk to
it.
