import { Hono } from 'hono'
import type { AppEnv } from '../../lib/types'
import { REGISTRY as ASR_REGISTRY } from '../../services/asr'
import { type SystemSettings, getSettings, updateSettings } from '../../services/db/system-settings'

const settings = new Hono<AppEnv>()

// Secret fields are stripped from GET responses. On PUT, any missing secret
// field on a provider's config is preserved from the existing stored value, so
// the UI can round-trip the scrubbed payload without wiping credentials.
const SECRET_FIELD_RE = /(^|_)(api_key|access_key_secret|secret|token|password)$/i

function isSecretField(name: string): boolean {
  return SECRET_FIELD_RE.test(name)
}

function stripSecretsFromProvider(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (isSecretField(k)) continue
    out[k] = v
  }
  return out
}

function stripSecrets(providers: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [name, raw] of Object.entries(providers)) {
    out[name] = stripSecretsFromProvider(raw)
  }
  return out
}

function mergeMissingSecrets(
  incoming: Record<string, unknown>,
  current: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [name, inc] of Object.entries(incoming)) {
    const cur = current[name]
    if (
      inc &&
      typeof inc === 'object' &&
      !Array.isArray(inc) &&
      cur &&
      typeof cur === 'object' &&
      !Array.isArray(cur)
    ) {
      const merged: Record<string, unknown> = { ...(inc as Record<string, unknown>) }
      for (const [k, v] of Object.entries(cur as Record<string, unknown>)) {
        if (isSecretField(k) && !(k in merged)) {
          merged[k] = v
        }
      }
      out[name] = merged
    } else {
      out[name] = inc
    }
  }
  return out
}

settings.get('/', async (c) => {
  const data = await getSettings()
  return c.json({
    ...data,
    asr_providers: stripSecrets(data.asr_providers),
    asr_available_providers: Object.keys(ASR_REGISTRY),
  })
})

settings.put('/', async (c) => {
  const body = await c.req.json<Partial<SystemSettings>>()
  const patch: Partial<SystemSettings> = {}

  if ('asr_active_provider' in body) {
    const v = body.asr_active_provider
    if (v !== null && (typeof v !== 'string' || !ASR_REGISTRY[v])) {
      return c.json({ error: `unknown ASR provider: ${v}` }, 400)
    }
    patch.asr_active_provider = v
  }

  if ('asr_providers' in body) {
    const providers = body.asr_providers
    if (!providers || typeof providers !== 'object') {
      return c.json({ error: 'asr_providers must be an object' }, 400)
    }

    const current = await getSettings()
    const merged = mergeMissingSecrets(providers, current.asr_providers)

    for (const [name, raw] of Object.entries(merged)) {
      const mod = ASR_REGISTRY[name]
      if (!mod) continue
      const result = mod.configSchema.safeParse(raw)
      if (!result.success) {
        return c.json({ error: `invalid config for ${name}`, issues: result.error.issues }, 400)
      }
      merged[name] = result.data
    }
    patch.asr_providers = merged
  }

  const userId = c.get('user').sub
  const updated = await updateSettings(patch, userId)
  return c.json({
    ...updated,
    asr_providers: stripSecrets(updated.asr_providers),
  })
})

export default settings
