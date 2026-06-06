import { z } from 'zod'
import type { AsrProviderModule } from '../registry'
import type { AsrInput, AsrProvider, AsrResult } from '../types'

const name = 'openai'

const configSchema = z.object({
  api_key: z.string().min(1),
  model: z.string().default('gpt-4o-mini-transcribe'),
  base_url: z.string().url().optional(),
})

type Config = z.infer<typeof configSchema>

const RESPONSE_FORMAT_BY_MODEL: Record<string, 'verbose_json' | 'json'> = {
  'whisper-1': 'verbose_json',
}

function create(config: Config): AsrProvider {
  return {
    name,
    async transcribe(input: AsrInput): Promise<AsrResult> {
      const baseUrl = config.base_url?.replace(/\/+$/, '') ?? 'https://api.openai.com/v1'
      const responseFormat = RESPONSE_FORMAT_BY_MODEL[config.model] ?? 'json'

      const form = new FormData()
      form.append(
        'file',
        new Blob([new Uint8Array(input.audio)], { type: 'audio/wav' }),
        'audio.wav',
      )
      form.append('model', config.model)
      form.append('response_format', responseFormat)
      if (input.language && input.language !== 'auto') {
        form.append('language', input.language)
      }
      if (input.hint) {
        form.append('prompt', input.hint)
      }

      const res = await fetch(`${baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.api_key}` },
        body: form,
      })

      if (!res.ok) {
        throw new Error(`openai transcribe failed: ${res.status} ${await res.text()}`)
      }

      const data = (await res.json()) as { text: string; language?: string; duration?: number }
      return {
        text: data.text,
        language: data.language,
        duration_ms: data.duration != null ? Math.round(data.duration * 1000) : undefined,
      }
    },
  }
}

export default { name, configSchema, create } satisfies AsrProviderModule<Config>
