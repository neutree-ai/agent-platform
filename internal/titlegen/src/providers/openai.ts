import type { TitleGenProviderModule } from '../registry'
import type { TitleGenChatInput, TitleGenProvider } from '../types'

const name = 'openai'

const DEFAULT_MODEL = 'gpt-4o-mini'

interface Config {
  api_key: string
  model: string
  base_url?: string
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
    return {
      success: true,
      data: {
        api_key: raw.api_key,
        model: typeof raw.model === 'string' && raw.model ? raw.model : DEFAULT_MODEL,
        base_url: typeof raw.base_url === 'string' ? raw.base_url : undefined,
      },
    }
  },
}

function create(config: Config): TitleGenProvider {
  return {
    name,
    async chat(input: TitleGenChatInput): Promise<string> {
      const baseUrl = config.base_url?.replace(/\/+$/, '') ?? 'https://api.openai.com/v1'

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.api_key}`,
        },
        body: JSON.stringify({
          model: config.model,
          max_tokens: input.maxTokens ?? 32,
          messages: [
            { role: 'system', content: input.system },
            { role: 'user', content: input.user },
          ],
        }),
      })

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
