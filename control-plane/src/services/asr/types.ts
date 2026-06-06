export interface AsrInput {
  audio: Buffer
  language?: string
  hint?: string
}

export interface AsrResult {
  text: string
  language?: string
  duration_ms?: number
}

export interface AsrProvider {
  readonly name: string
  transcribe(input: AsrInput): Promise<AsrResult>
}
