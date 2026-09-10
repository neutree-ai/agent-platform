import { z } from 'zod'
import type { AsrProviderModule } from '../registry'
import type { AsrInput, AsrProvider, AsrResult } from '../types'

const name = 'funasr'

// Fun-ASR-Nano (Qwen3-0.6B + SenseVoice, ~800M). Alongside an OpenAI-compatible
// /v1/audio/transcriptions endpoint it serves a richer native /asr endpoint
// (hotwords, char-level timestamps, duration). We use /asr so the caller's
// `hint` can be forwarded as hotwords and the reported duration kept.
// Auth depends on how the server is fronted: a direct vLLM deployment guards it
// with HTTP Basic (it rejects a Bearer token, so an OpenAI-compatible client
// cannot talk to it directly), while behind the inference gateway the same
// server takes a Bearer API key. Set `api_key` for the gateway, or
// `username`/`password` for a direct deployment.
const configSchema = z
  .object({
    base_url: z.string().url().default('http://localhost:8899'),
    username: z.string().min(1).default('funasr'),
    password: z.string().min(1).optional(),
    api_key: z.string().min(1).optional(),
  })
  .refine((c) => Boolean(c.api_key || c.password), {
    message: 'funasr needs either api_key (gateway) or password (basic auth)',
  })

type Config = z.infer<typeof configSchema>

// The service takes a spelled-out language name, or none at all to auto-detect.
// Map the canonical codes callers use onto what it expects; anything unknown
// falls through to auto.
const LANGUAGE_NAMES: Record<string, string> = {
  zh: '中文',
  en: 'English',
  ja: '日本語',
}

interface AsrResponse {
  text: string
  // VAD-cut segments (up to 60s each), in order. We emit one per line so a long
  // transcript arrives as readable chunks rather than a single paragraph.
  segments?: { text?: string }[]
  duration?: number // seconds
}

function create(config: Config): AsrProvider {
  const authHeader = config.api_key
    ? `Bearer ${config.api_key}`
    : `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`

  return {
    name,
    async transcribe(input: AsrInput): Promise<AsrResult> {
      const baseUrl = config.base_url.replace(/\/+$/, '')

      const form = new FormData()
      // Audio reaches a provider already normalized to 16 kHz mono WAV, which is
      // what this endpoint wants; it errors on containers like m4a and flac.
      form.append(
        'file',
        new Blob([new Uint8Array(input.audio)], { type: 'audio/wav' }),
        'audio.wav',
      )
      if (input.language && input.language !== 'auto') {
        const langName = LANGUAGE_NAMES[input.language]
        if (langName) form.append('language', langName)
      }
      // The caller's transcription hint doubles as hotwords: comma-separated
      // domain terms that bias decoding.
      if (input.hint) form.append('hotwords', input.hint)
      form.append('timestamp', 'false')

      const res = await fetch(`${baseUrl}/asr`, {
        method: 'POST',
        headers: { Authorization: authHeader },
        body: form,
      })

      if (!res.ok) {
        throw new Error(
          `funasr transcribe failed: ${res.status} ${await res.text().catch(() => '')}`,
        )
      }

      const data = (await res.json()) as AsrResponse
      // One segment per line; fall back to the flat text when segments are absent.
      const lines = data.segments?.map((s) => s.text?.trim() ?? '').filter(Boolean) ?? []
      const text = lines.length ? lines.join('\n') : (data.text ?? '')
      return {
        text,
        language: input.language && input.language !== 'auto' ? input.language : undefined,
        duration_ms: data.duration != null ? Math.round(data.duration * 1000) : undefined,
      }
    },
  }
}

export default { name, configSchema, create } satisfies AsrProviderModule<Config>
