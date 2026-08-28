import { Hono } from 'hono'
import { REGISTRY as TITLEGEN_REGISTRY } from '../../../../internal/titlegen/src'
import type { AppEnv } from '../../lib/types'
import { REGISTRY as ASR_REGISTRY } from '../../services/asr'
import { type SystemSettings, getSettings, updateSettings } from '../../services/db/system-settings'

// Structural shape of a provider config validator — only the `safeParse` we use.
// Kept loose so registries backed by different zod installs (cp's own vs the
// shared internal/titlegen package) are both assignable.
interface ConfigSchemaLike {
  safeParse(
    v: unknown,
  ): { success: true; data: unknown } | { success: false; error: { issues: unknown } }
}
type ProviderRegistry = Record<string, { configSchema: ConfigSchemaLike }>

const settings = new Hono<AppEnv>()

const BRANDING_NAME_MAX_LENGTH = 100
// Decoded byte cap — system_settings is a single-row table, so this bounds
// how much a logo can bloat every read of it.
const BRANDING_LOGO_MAX_BYTES = 256 * 1024
const BRANDING_LOGO_MIME_TYPES = new Set([
  'image/svg+xml',
  'image/png',
  'image/jpeg',
  'image/x-icon',
])

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
    titlegen_providers: stripSecrets(data.titlegen_providers),
    titlegen_available_providers: Object.keys(TITLEGEN_REGISTRY),
  })
})

// Validate + secret-merge a `{ providerName: config }` map against a registry,
// mutating `patch[providersKey]`. Returns an error response to short-circuit on,
// or null on success.
function applyProviders(
  registry: ProviderRegistry,
  label: string,
  incoming: unknown,
  current: Record<string, unknown>,
): { error: { message: string; issues?: unknown } } | { value: Record<string, unknown> } {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return { error: { message: `${label} must be an object` } }
  }
  const merged = mergeMissingSecrets(incoming as Record<string, unknown>, current)
  for (const [name, raw] of Object.entries(merged)) {
    const mod = registry[name]
    if (!mod) continue
    const result = mod.configSchema.safeParse(raw)
    if (!result.success) {
      return { error: { message: `invalid config for ${name}`, issues: result.error.issues } }
    }
    merged[name] = result.data
  }
  return { value: merged }
}

settings.put('/', async (c) => {
  const body = await c.req.json<Partial<SystemSettings>>()
  const patch: Partial<SystemSettings> = {}
  const current = await getSettings()

  if ('asr_active_provider' in body) {
    const v = body.asr_active_provider
    if (v !== null && (typeof v !== 'string' || !ASR_REGISTRY[v])) {
      return c.json({ error: `unknown ASR provider: ${v}` }, 400)
    }
    patch.asr_active_provider = v
  }

  if ('asr_providers' in body) {
    const res = applyProviders(
      ASR_REGISTRY,
      'asr_providers',
      body.asr_providers,
      current.asr_providers,
    )
    if ('error' in res) return c.json({ error: res.error.message, issues: res.error.issues }, 400)
    patch.asr_providers = res.value
  }

  if ('titlegen_active_provider' in body) {
    const v = body.titlegen_active_provider
    if (v !== null && (typeof v !== 'string' || !TITLEGEN_REGISTRY[v])) {
      return c.json({ error: `unknown title-gen provider: ${v}` }, 400)
    }
    patch.titlegen_active_provider = v
  }

  if ('titlegen_providers' in body) {
    const res = applyProviders(
      TITLEGEN_REGISTRY,
      'titlegen_providers',
      body.titlegen_providers,
      current.titlegen_providers,
    )
    if ('error' in res) return c.json({ error: res.error.message, issues: res.error.issues }, 400)
    patch.titlegen_providers = res.value
  }

  if ('branding_short_name' in body) {
    const v = body.branding_short_name
    if (v !== null && (typeof v !== 'string' || !v.trim() || v.length > BRANDING_NAME_MAX_LENGTH)) {
      return c.json(
        { error: `branding_short_name must be 1-${BRANDING_NAME_MAX_LENGTH} characters` },
        400,
      )
    }
    patch.branding_short_name = v
  }

  if ('branding_full_name' in body) {
    const v = body.branding_full_name
    if (v !== null && (typeof v !== 'string' || !v.trim() || v.length > BRANDING_NAME_MAX_LENGTH)) {
      return c.json(
        { error: `branding_full_name must be 1-${BRANDING_NAME_MAX_LENGTH} characters` },
        400,
      )
    }
    patch.branding_full_name = v
  }

  if ('branding_logo_data' in body || 'branding_logo_mime' in body) {
    const data = body.branding_logo_data
    const mime = body.branding_logo_mime
    if (data === null && mime === null) {
      patch.branding_logo_data = null
      patch.branding_logo_mime = null
    } else {
      if (typeof mime !== 'string' || !BRANDING_LOGO_MIME_TYPES.has(mime)) {
        return c.json(
          {
            error: `branding_logo_mime must be one of: ${[...BRANDING_LOGO_MIME_TYPES].join(', ')}`,
          },
          400,
        )
      }
      if (typeof data !== 'string') {
        return c.json({ error: 'branding_logo_data must be a base64 string' }, 400)
      }
      let decodedLength: number
      try {
        decodedLength = Buffer.from(data, 'base64').length
      } catch {
        return c.json({ error: 'branding_logo_data is not valid base64' }, 400)
      }
      if (decodedLength === 0 || decodedLength > BRANDING_LOGO_MAX_BYTES) {
        return c.json(
          { error: `branding_logo_data must decode to 1-${BRANDING_LOGO_MAX_BYTES} bytes` },
          400,
        )
      }
      patch.branding_logo_data = data
      patch.branding_logo_mime = mime
    }
  }

  const userId = c.get('user').sub
  const updated = await updateSettings(patch, userId)
  return c.json({
    ...updated,
    asr_providers: stripSecrets(updated.asr_providers),
    titlegen_providers: stripSecrets(updated.titlegen_providers),
  })
})

export default settings
