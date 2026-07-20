import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { NapClient } from '../../internal/client/src'
import { type E2eProfile, loadProfile } from './config'

// ---------------------------------------------------------------------------
// Remote harness
// ---------------------------------------------------------------------------
// Every run provisions a throwaway user on the target control plane and drives
// the whole suite as that user. Nothing else on the deployment is touched, so
// the suite is safe to point at a freshly installed cluster without risking a
// real account's workspaces, credentials or default prompt.
//
// Teardown deletes that user. The users table has no ON DELETE CASCADE for
// workspaces / providers / skills / shares / schedules, so the delete only
// succeeds once those are gone — which makes it a leak assertion rather than a
// best-effort sweep. Workspaces in particular must be deleted through the API:
// their Kubernetes resources are reconciled from workspace_placements, so
// removing rows behind the control plane's back would strand pods and PVCs.

interface Harness {
  profile: E2eProfile
  /** Client authenticated as the throwaway run user, via service token. */
  client: NapClient
  /** Plaintext service token, handed to test workers so they can rebuild the client. */
  serviceToken: string
  /** Identifier shared by every resource this run creates. */
  runId: string
  /** Username of the throwaway user. */
  username: string
  userId: string
}

let harness: Harness | undefined
let adminCookie: string | undefined

// ---------------------------------------------------------------------------
// Admin session (raw fetch — admin routes are deliberately not on NapClient)
// ---------------------------------------------------------------------------

async function adminLogin(profile: E2eProfile): Promise<void> {
  const res = await fetch(`${profile.baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: profile.admin.username,
      password: profile.admin.password,
    }),
  })
  if (!res.ok) {
    throw new Error(
      `Admin login failed (${res.status}). Check baseUrl and admin credentials in the E2E profile.`,
    )
  }
  const setCookie = res.headers.get('set-cookie')
  const match = setCookie?.match(/token=([^;]+)/)
  if (!match) throw new Error('Admin login succeeded but returned no session cookie')
  adminCookie = match[1]
}

async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const profile = loadProfile()
  const res = await fetch(`${profile.baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Cookie: `token=${adminCookie}`,
      ...(init?.headers as Record<string, string>),
    },
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = (await res.json()) as { error?: string }
      if (body?.error) detail = body.error
    } catch {
      // non-JSON body, statusText is the best we have
    }
    throw new Error(`Admin API ${res.status}: ${detail} (${path})`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------

/**
 * Consent check. Runs before anything touches the network, so an unconfirmed
 * profile never reaches the target at all — not even to log in.
 */
function assertConsent(profile: E2eProfile): void {
  if (!profile.confirmMutatesTarget) {
    throw new Error(
      [
        'Refusing to run: the E2E suite creates and deletes real data on the target.',
        `Target: ${profile.baseUrl}`,
        '',
        'Set "confirmMutatesTarget": true in the profile once you are sure this is',
        'a test deployment and not a production control plane.',
      ].join('\n'),
    )
  }
}

/** Freshness check. Needs an admin session, so it runs after login. */
async function preflight(profile: E2eProfile): Promise<void> {
  // The route already excludes system accounts, so everything returned here is
  // a human user. A fresh install has exactly one: the admin.
  const { items, total } = await adminFetch<{
    items: Array<{ id: string; username: string; role: string }>
    total: number
  }>('/api/admin/users?page=1&pageSize=100')

  const strangers = items.filter((u) => u.username !== profile.admin.username)

  if (strangers.length > 0 && !profile.allowNonPristineTarget) {
    throw new Error(
      [
        `Refusing to run: ${profile.baseUrl} already has ${strangers.length} user account(s)`,
        `beyond "${profile.admin.username}" (${total} total). This looks like a deployment`,
        'somebody is using, not a fresh install.',
        '',
        `  ${strangers
          .slice(0, 5)
          .map((u) => u.username)
          .join(', ')}${strangers.length > 5 ? ', …' : ''}`,
        '',
        'Set "allowNonPristineTarget": true in the profile to run anyway. The suite',
        'still confines itself to a throwaway user, but you are asserting that this',
        'target is expendable.',
      ].join('\n'),
    )
  }
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

// Kept short: run ids end up inside workspace names, which in turn seed
// Kubernetes object names, and those have a 63-character ceiling.
function makeRunId(): string {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(2, 12)
  const rand = Math.random().toString(36).slice(2, 6)
  return `${stamp}${rand}`
}

export async function setupHarness(): Promise<Harness> {
  const profile = loadProfile()

  assertConsent(profile)
  await adminLogin(profile)
  await preflight(profile)

  const runId = makeRunId()
  const username = `e2e-${runId}`
  // Never reused, never persisted — the account is deleted during teardown.
  const password = `e2e-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`

  const created = await adminFetch<{ id: string; username: string }>('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify({
      username,
      display_name: `E2E run ${runId}`,
      password,
      role: 'user',
    }),
  })

  // The control plane always derives a service token's owner from the caller,
  // so the token has to be minted by the run user itself rather than by admin.
  const userClient = new NapClient({ baseUrl: profile.baseUrl })
  await userClient.auth.login(username, password)
  const token = await userClient.serviceTokens.create({ name: `e2e-${runId}` })
  // The plaintext token is returned exactly once, at creation.
  if (!token.token) {
    throw new Error('Service token was created but the response carried no plaintext token')
  }

  const bootstrapped: Harness = {
    profile,
    client: new NapClient({ baseUrl: profile.baseUrl, serviceToken: token.token }),
    serviceToken: token.token,
    runId,
    username,
    userId: created.id,
  }
  harness = bootstrapped

  console.log(`[e2e] target ${profile.baseUrl}`)
  console.log(`[e2e] run user ${username} (${created.id})`)

  return bootstrapped
}

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

async function waitForStopped(client: NapClient, wsId: string, maxWaitMs = 90_000) {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    const list = await client.workspaces.list()
    const ws = list.find((w) => w.id === wsId)
    if (!ws || ws.status === 'stopped' || ws.status === 'error') return
    await new Promise((r) => setTimeout(r, 3000))
  }
}

/**
 * Release everything the run user owns. Workspaces go through stop → delete so
 * the reconciler reclaims their Kubernetes resources; the rest is best effort,
 * because the final user delete is what actually proves the account is clean.
 */
async function releaseResources(client: NapClient): Promise<string[]> {
  const problems: string[] = []

  try {
    const workspaces = await client.workspaces.list()
    for (const ws of workspaces) {
      try {
        if (ws.status !== 'stopped') {
          await client.workspaces.stop(ws.id).catch(() => {})
          await waitForStopped(client, ws.id)
        }
        await client.workspaces.delete(ws.id)
      } catch (err) {
        problems.push(`workspace ${ws.name} (${ws.id}): ${(err as Error).message}`)
      }
    }
  } catch (err) {
    problems.push(`listing workspaces: ${(err as Error).message}`)
  }

  try {
    for (const provider of await client.providers.list()) {
      await client.providers.delete(provider.id).catch((err: Error) => {
        problems.push(`provider ${provider.name}: ${err.message}`)
      })
    }
  } catch (err) {
    problems.push(`listing providers: ${(err as Error).message}`)
  }

  // Skills before their sources: a source refuses to go while it still has
  // skills, and skill_sources is one of the tables holding a hard reference to
  // the user.
  try {
    for (const skill of await client.skills.list()) {
      await client.skills.delete(skill.id).catch((err: Error) => {
        problems.push(`skill ${skill.name}: ${err.message}`)
      })
    }
    for (const source of await client.skills.listSources()) {
      await client.skills.deleteSource(source.id).catch((err: Error) => {
        problems.push(`skill source ${source.id}: ${err.message}`)
      })
    }
  } catch (err) {
    problems.push(`listing skills: ${(err as Error).message}`)
  }

  try {
    for (const template of await client.templates.list()) {
      await client.templates.delete(template.id).catch(() => {})
    }
  } catch {
    // templates cascade with the user; a failure here is not fatal
  }

  try {
    for (const prompt of await client.prompts.list()) {
      await client.prompts.delete(prompt.id).catch(() => {})
    }
  } catch {
    // prompts cascade with the user
  }

  return problems
}

export async function teardownHarness(failed: boolean): Promise<void> {
  if (!harness) return
  const { client, profile, userId, username } = harness

  if (failed) {
    await captureDiagnostics().catch((err) =>
      console.error(`[e2e] diagnostics capture failed: ${(err as Error).message}`),
    )
    if (process.env.E2E_KEEP_ON_FAILURE === '1') {
      console.warn(
        [
          '',
          `[e2e] E2E_KEEP_ON_FAILURE=1 — leaving run user "${username}" and its`,
          '[e2e] resources in place for inspection. The next run against this target',
          '[e2e] will refuse to start unless you clean it up or set',
          '[e2e] allowNonPristineTarget. To clean up manually:',
          `[e2e]   DELETE ${profile.baseUrl}/api/admin/users/${userId}`,
          '',
        ].join('\n'),
      )
      return
    }
  }

  const problems = await releaseResources(client)

  try {
    await adminFetch(`/api/admin/users/${userId}`, { method: 'DELETE' })
  } catch (err) {
    // users has no ON DELETE CASCADE for workspaces, providers, skills, shares
    // or schedules, so a failure here means the run left something behind.
    const detail = problems.length > 0 ? `\n  ${problems.join('\n  ')}` : ''
    throw new Error(
      `[e2e] run user ${username} (${userId}) could not be deleted — the run leaked ` +
        `resources that still reference it: ${(err as Error).message}${detail}`,
    )
  }

  if (problems.length > 0) {
    console.warn(`[e2e] cleanup warnings:\n  ${problems.join('\n  ')}`)
  }
  console.log(`[e2e] run user ${username} removed`)
  harness = undefined
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

/**
 * Snapshot enough state to debug a failure after the target has been cleaned
 * up. API state always; cluster state only when kubectl is usable, since the
 * suite is normally driven from a workstation rather than the node.
 */
async function captureDiagnostics(): Promise<string | undefined> {
  if (!harness) return undefined
  const { client, profile, runId, username } = harness

  const dir = join(profile.artifactsDir, runId)
  mkdirSync(dir, { recursive: true })

  const write = (name: string, content: string) => writeFileSync(join(dir, name), content)

  try {
    const workspaces = await client.workspaces.list()
    write('workspaces.json', JSON.stringify(workspaces, null, 2))

    for (const ws of workspaces) {
      try {
        const sessions = await client.sessions.list(ws.id)
        write(`sessions-${ws.name}.json`, JSON.stringify(sessions, null, 2))
      } catch {
        // a workspace that never started has no sessions to report
      }
    }
  } catch (err) {
    write('workspaces.error.txt', String(err))
  }

  write(
    'run.json',
    JSON.stringify(
      { runId, username, baseUrl: profile.baseUrl, capturedAt: new Date().toISOString() },
      null,
      2,
    ),
  )

  const namespace = process.env.E2E_K8S_NAMESPACE
  if (namespace && process.env.KUBECONFIG) {
    const kubectl = (args: string[]) =>
      execFileSync('kubectl', ['-n', namespace, ...args], {
        encoding: 'utf-8',
        timeout: 30_000,
      })
    for (const [name, args] of [
      ['pods.txt', ['get', 'pods', '-o', 'wide']],
      ['events.txt', ['get', 'events', '--sort-by=.lastTimestamp']],
      ['deployments.txt', ['get', 'deploy']],
    ] as Array<[string, string[]]>) {
      try {
        write(name, kubectl(args))
      } catch (err) {
        write(`${name}.error.txt`, String(err))
      }
    }
  }

  console.error(`[e2e] diagnostics written to ${dir}`)
  return dir
}
