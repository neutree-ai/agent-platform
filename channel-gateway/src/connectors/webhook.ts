import { createHmac, timingSafeEqual } from 'node:crypto'
import { Hono } from 'hono'
import { TosClient } from '../../../internal/client/src/index'
import * as db from '../services/db'

const NAP_API_URL = process.env.NAP_API_URL || 'http://localhost:3000'

/**
 * Resolve a nested field from an object using dot notation.
 * e.g. resolve({ a: { b: 'c' } }, 'a.b') => 'c'
 */
function resolve(obj: unknown, path: string): unknown {
  let current = obj
  for (const key of path.split('.')) {
    if (current == null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

/**
 * Apply a prompt template with variable substitution.
 * Supports {body}, {body.xxx}, {query.xxx}, {headers.xxx}, {method}, {path}.
 * Unknown variables are left as-is.
 */
function applyTemplate(
  template: string,
  ctx: { body: unknown; query: Record<string, string>; headers: Record<string, string>; method: string; path: string },
): string {
  return template.replace(/\{([^}]+)\}/g, (match, key: string) => {
    if (key === 'body') return typeof ctx.body === 'string' ? ctx.body : JSON.stringify(ctx.body)
    if (key === 'method') return ctx.method
    if (key === 'path') return ctx.path
    if (key.startsWith('body.')) {
      const val = resolve(ctx.body, key.slice(5))
      return val !== undefined ? String(val) : match
    }
    if (key.startsWith('query.')) {
      return ctx.query[key.slice(6)] ?? match
    }
    if (key.startsWith('headers.')) {
      return ctx.headers[key.slice(8).toLowerCase()] ?? match
    }
    return match
  })
}

/**
 * Filter rule: field + operator + value.
 * Field uses the same syntax as template variables: body.xxx, query.xxx, headers.xxx, method, path.
 */
interface FilterRule {
  field: string
  op: 'eq' | 'neq' | 'in' | 'contains' | 'exists'
  value?: unknown
}

/** Resolve a filter field from the request context. */
function resolveField(
  field: string,
  ctx: { body: unknown; query: Record<string, string>; headers: Record<string, string>; method: string; path: string },
): unknown {
  if (field === 'body') return ctx.body
  if (field === 'method') return ctx.method
  if (field === 'path') return ctx.path
  if (field.startsWith('body.')) return resolve(ctx.body, field.slice(5))
  if (field.startsWith('query.')) return ctx.query[field.slice(6)]
  if (field.startsWith('headers.')) return ctx.headers[field.slice(8).toLowerCase()]
  return undefined
}

/** Check if all filter rules match (AND logic). Empty filters = pass. */
function matchFilters(filters: FilterRule[], ctx: Parameters<typeof resolveField>[1]): boolean {
  for (const rule of filters) {
    const actual = resolveField(rule.field, ctx)
    switch (rule.op) {
      case 'eq':
        if (String(actual) !== String(rule.value)) return false
        break
      case 'neq':
        if (String(actual) === String(rule.value)) return false
        break
      case 'in':
        if (!Array.isArray(rule.value) || !rule.value.map(String).includes(String(actual))) return false
        break
      case 'contains':
        if (!String(actual).includes(String(rule.value))) return false
        break
      case 'exists':
        if ((actual !== undefined && actual !== null) !== (rule.value !== false)) return false
        break
    }
  }
  return true
}

/** Webhook types that share the same processing logic. */
const WEBHOOK_TYPES = new Set(['webhook', 'webhook-relay'])

/**
 * Core webhook processing logic — shared by direct HTTP handler and relay consumer.
 * Returns the result of processing the webhook payload.
 */
export async function handleWebhookPayload(opts: {
  connectorId: string
  externalId: string
  body: unknown
  rawBody?: string
  headers: Record<string, string>
  method: string
  query: Record<string, string>
  dedupKey?: string
}): Promise<{ ok: boolean; job_id?: string; filtered?: boolean; error?: string }> {
  const { connectorId, externalId, dedupKey } = opts

  // Idempotency check: skip if this message was already processed
  if (dedupKey && await db.eventExistsByDedupKey(dedupKey)) {
    console.log(`[Webhook] Dedup: already processed key=${dedupKey}`)
    return { ok: true }
  }

  const connector = await db.getConnector(connectorId)
  if (!connector || !WEBHOOK_TYPES.has(connector.type)) {
    return { ok: false, error: 'not found' }
  }
  if (!connector.enabled) {
    return { ok: false, error: 'connector disabled' }
  }

  // --- Route lookup ---
  const route = await db.getRouteByExternalId(connector.id, externalId)
  if (!route) {
    console.log(`[Webhook] ${connector.name}: no route for path=${externalId}, ignoring`)
    return { ok: false, error: 'no route for this path' }
  }

  // --- Secret validation (from route config) ---
  const routeConfig = route.config as Record<string, unknown>
  const secret = routeConfig?.secret as string | undefined
  if (secret) {
    const secretType = (routeConfig?.secret_type as string) || 'plain'
    const defaultHeader = secretType === 'hmac-sha256' ? 'X-Hub-Signature-256' : 'X-Webhook-Secret'
    const secretHeader = ((routeConfig?.secret_header as string) || defaultHeader).toLowerCase()
    const provided = opts.headers[secretHeader] ?? ''

    let valid = false
    if (secretType === 'hmac-sha256') {
      const raw = opts.rawBody ?? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body))
      const expected = createHmac('sha256', secret).update(raw).digest('hex')
      const signature = provided.startsWith('sha256=') ? provided.slice(7) : provided
      try {
        valid = signature.length === expected.length
          && timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
      } catch {
        valid = false
      }
    } else {
      valid = provided === secret
    }

    if (!valid) {
      return { ok: false, error: 'unauthorized' }
    }
  }

  // --- Build context ---
  const templateCtx = {
    body: opts.body,
    query: opts.query,
    headers: opts.headers,
    method: opts.method,
    path: externalId,
  }

  // --- Apply filters ---
  const filters = (routeConfig?.filters as FilterRule[]) || []
  if (filters.length > 0 && !matchFilters(filters, templateCtx)) {
    console.log(`[Webhook] ${connector.name}: filtered out path=${externalId}`)
    await db.logEvent({
      route_id: route.id,
      connector_id: connector.id,
      event_type: 'webhook',
      payload: { path: externalId, method: opts.method, filtered: true },
      status: 'filtered',
      dedup_key: dedupKey,
    })
    return { ok: true, filtered: true }
  }

  // --- Build prompt ---
  const promptTemplate = routeConfig?.prompt as string | undefined
  const finalPrompt = promptTemplate
    ? applyTemplate(promptTemplate, templateCtx)
    : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body, null, 2)

  // --- Get platform token and create job ---
  const platformToken = await db.getPlatformToken(connector.user_id)
  if (!platformToken) {
    console.error(`[Webhook] ${connector.name}: no platform token for user=${connector.user_id}`)
    return { ok: false, error: 'connector not configured (missing platform token)' }
  }

  const tosClient = new TosClient({ baseUrl: NAP_API_URL, serviceToken: platformToken })

  try {
    const result = await tosClient.jobs.create(route.workspace_id, {
      prompt: finalPrompt,
      trigger: {
        type: 'webhook',
        payload: {
          connector_id: connector.id,
          route_id: route.id,
          path: externalId,
        },
      },
    })
    console.log(`[Webhook] ${connector.name}: job created: ${result.id} path=${externalId}`)

    await db.logEvent({
      route_id: route.id,
      connector_id: connector.id,
      event_type: 'webhook',
      payload: { path: externalId, method: opts.method, body: typeof opts.body === 'string' ? opts.body.slice(0, 4000) : opts.body },
      job_id: result.id,
      status: 'success',
      dedup_key: dedupKey,
    })

    return { ok: true, job_id: result.id }
  } catch (e) {
    console.error(`[Webhook] ${connector.name}: failed to create job:`, e)

    await db.logEvent({
      route_id: route.id,
      connector_id: connector.id,
      event_type: 'webhook',
      payload: { path: externalId, method: opts.method, body: typeof opts.body === 'string' ? opts.body.slice(0, 4000) : opts.body },
      status: 'error',
      error: e instanceof Error ? e.message : String(e),
      dedup_key: dedupKey,
    })

    return { ok: false, error: 'failed to create job' }
  }
}

/** Create the Hono router for webhook ingestion. No auth — uses connector secret. */
export function createWebhookRouter() {
  const router = new Hono()

  // POST /webhook/:connectorId/:path
  router.post('/:connectorId/:path', async (c) => {
    const connectorId = c.req.param('connectorId')
    const externalId = `/${c.req.param('path')}`

    // --- Parse body (keep raw for HMAC) ---
    const rawBody = await c.req.text()
    let body: unknown = rawBody
    const contentType = c.req.header('content-type') || ''
    if (contentType.includes('application/json')) {
      try {
        body = JSON.parse(rawBody)
      } catch {
        return c.json({ error: 'invalid JSON body' }, 400)
      }
    }

    // --- Build query and headers ---
    const query: Record<string, string> = {}
    for (const [k, v] of new URL(c.req.url).searchParams) {
      query[k] = v
    }
    const headers: Record<string, string> = {}
    c.req.raw.headers.forEach((v, k) => { headers[k] = v })

    const result = await handleWebhookPayload({ connectorId, externalId, body, rawBody, headers, method: c.req.method, query })

    if (result.error === 'not found') return c.json({ error: 'not found' }, 404)
    if (result.error === 'connector disabled') return c.json({ error: 'connector disabled' }, 403)
    if (result.error === 'unauthorized') return c.json({ error: 'unauthorized' }, 401)
    if (result.error === 'no route for this path') return c.json({ error: 'no route for this path' }, 404)
    if (result.error === 'connector not configured (missing platform token)') return c.json({ error: result.error }, 500)
    if (result.error === 'failed to create job') return c.json({ error: 'failed to create job' }, 500)
    if (result.filtered) return c.json({ ok: true, filtered: true })
    return c.json({ ok: true, job_id: result.job_id })
  })

  return router
}
