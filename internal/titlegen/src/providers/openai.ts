import type { TitleGenProviderModule } from '../registry'
import type { TitleGenChatInput, TitleGenProvider } from '../types'

const name = 'openai'

const DEFAULT_MODEL = 'gpt-4o-mini'
// Output token cap. 0 means unlimited — send no cap at all (model default),
// which also lets reasoning models spend their reasoning budget freely.
const DEFAULT_MAX_TOKENS = 256

interface Config {
  api_key: string
  model: string
  base_url?: string
  max_tokens: number
}

// Hand-rolled validator (no zod, to keep this shared package dependency-free).
// Applies the same defaults zod would and reports issues in the shape the
// control-plane admin route expects.
const configSchema: TitleGenProviderModule<Config>['configSchema'] = {
  safeParse(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) {
      return { success: false, error: { issues: [{ message: 'config must be an object' }] } }
    }
    const raw = v as Record<string, unknown>
    if (typeof raw.api_key !== 'string' || raw.api_key.length === 0) {
      return {
        success: false,
        error: { issues: [{ path: ['api_key'], message: 'api_key is required' }] },
      }
    }
    if (raw.model !== undefined && typeof raw.model !== 'string') {
      return {
        success: false,
        error: { issues: [{ path: ['model'], message: 'model must be a string' }] },
      }
    }
    if (raw.base_url !== undefined && typeof raw.base_url !== 'string') {
      return {
        success: false,
        error: { issues: [{ path: ['base_url'], message: 'base_url must be a string' }] },
      }
    }
    if (
      raw.max_tokens !== undefined &&
      (typeof raw.max_tokens !== 'number' ||
        !Number.isInteger(raw.max_tokens) ||
        raw.max_tokens < 0)
    ) {
      return {
        success: false,
        error: {
          issues: [
            {
              path: ['max_tokens'],
              message: 'max_tokens must be a non-negative integer (0 = unlimited)',
            },
          ],
        },
      }
    }
    return {
      success: true,
      data: {
        api_key: raw.api_key,
        model: typeof raw.model === 'string' && raw.model ? raw.model : DEFAULT_MODEL,
        base_url: typeof raw.base_url === 'string' ? raw.base_url : undefined,
        max_tokens: typeof raw.max_tokens === 'number' ? raw.max_tokens : DEFAULT_MAX_TOKENS,
      },
    }
  },
}

function create(config: Config): TitleGenProvider {
  return {
    name,
    async chat(input: TitleGenChatInput): Promise<string> {
      const baseUrl = config.base_url?.replace(/\/+$/, '') ?? 'https://api.openai.com/v1'
      const messages = [
        { role: 'system', content: input.system },
        { role: 'user', content: input.user },
      ]

      // Omit the token param entirely when max_tokens is 0 (unlimited).
      const post = (tokenParam?: 'max_tokens' | 'max_completion_tokens') => {
        const body: Record<string, unknown> = { model: config.model, messages }
        if (tokenParam) body[tokenParam] = config.max_tokens
        return fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.api_key}`,
          },
          body: JSON.stringify(body),
        })
      }

      const capped = config.max_tokens > 0
      let res = await post(capped ? 'max_tokens' : undefined)

      // Reasoning models (o1/o3/gpt-5, …) reject `max_tokens` on /chat/completions
      // and require `max_completion_tokens`. Retry once with the newer param when
      // the error says so. (Only relevant when a cap is actually sent.)
      if (capped && !res.ok && res.status === 400) {
        const errText = await res.text().catch(() => '')
        if (/max_completion_tokens/i.test(errText)) {
          res = await post('max_completion_tokens')
        } else {
          throw new Error(`openai title-gen failed: 400 ${errText}`)
        }
      }

      if (!res.ok) {
        throw new Error(`openai title-gen failed: ${res.status} ${await res.text()}`)
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>
      }
      return data.choices?.[0]?.message?.content ?? ''
    },
  }
}

export default { name, configSchema, create } satisfies TitleGenProviderModule<Config>
