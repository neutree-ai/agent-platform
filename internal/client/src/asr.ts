import { HttpClient } from './http'

export interface AsrTranscribeOptions {
  language?: string
  hint?: string
  /** Override the multipart filename. Useful when the backend ffmpeg dispatch
   *  benefits from a hint about the source container (e.g. `voice.amr`). */
  filename?: string
  /** Defaults to `application/octet-stream`. */
  contentType?: string
}

export interface AsrTranscribeResult {
  text: string
  language?: string
  duration_ms?: number
}

export class AsrApi {
  constructor(private http: HttpClient) {}

  async transcribe(
    audio: Buffer | Uint8Array | Blob,
    opts: AsrTranscribeOptions = {},
  ): Promise<AsrTranscribeResult> {
    const { language, hint, filename = 'audio', contentType = 'application/octet-stream' } = opts

    const blob =
      audio instanceof Blob
        ? audio
        : new Blob([new Uint8Array(audio as Buffer)], { type: contentType })

    const form = new FormData()
    form.append('audio', blob, filename)
    if (language) form.append('language', language)
    if (hint) form.append('hint', hint)

    return this.http.fetchJson<AsrTranscribeResult>('/api/asr/transcribe', {
      method: 'POST',
      body: form,
    })
  }
}
