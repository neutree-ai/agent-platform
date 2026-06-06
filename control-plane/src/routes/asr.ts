import { Hono } from 'hono'
import type { AppEnv } from '../lib/types'
import { AsrNotConfiguredError, getActiveAsrProvider, transcodeToWav16kMono } from '../services/asr'
import type { AsrProvider } from '../services/asr/types'

const MAX_AUDIO_BYTES = 25 * 1024 * 1024 // 25 MB

const asr = new Hono<AppEnv>()

asr.post('/transcribe', async (c) => {
  const form = await c.req.formData()
  const file = form.get('audio')
  const language = form.get('language')
  const hint = form.get('hint')

  if (!(file instanceof File)) {
    return c.json({ error: 'audio is required' }, 400)
  }
  if (file.size > MAX_AUDIO_BYTES) {
    return c.json({ error: `audio too large: ${file.size} > ${MAX_AUDIO_BYTES}` }, 400)
  }

  let provider: AsrProvider
  try {
    provider = await getActiveAsrProvider()
  } catch (e) {
    if (e instanceof AsrNotConfiguredError) {
      return c.json({ error: e.message }, 503)
    }
    throw e
  }

  let wav: Buffer
  try {
    wav = await transcodeToWav16kMono(Buffer.from(await file.arrayBuffer()))
  } catch (e) {
    return c.json({ error: `failed to decode audio: ${(e as Error).message}` }, 400)
  }

  const result = await provider.transcribe({
    audio: wav,
    language: typeof language === 'string' && language ? language : undefined,
    hint: typeof hint === 'string' && hint ? hint : undefined,
  })
  return c.json(result)
})

export default asr
