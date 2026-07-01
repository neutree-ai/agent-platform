export interface TitleGenChatInput {
  /** System instruction describing the title-generation task. */
  system: string
  /** User content — the session's first user message (already truncated). */
  user: string
  /** Upper bound on generated tokens. Titles are short; keep this small. */
  maxTokens?: number
}

export interface TitleGenProvider {
  readonly name: string
  /**
   * Single-shot chat completion returning the raw model text. The caller owns
   * prompt construction and post-processing so behaviour stays uniform across
   * providers.
   */
  chat(input: TitleGenChatInput): Promise<string>
}
