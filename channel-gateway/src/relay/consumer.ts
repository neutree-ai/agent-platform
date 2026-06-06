import type { RelayMessage, RelaySource } from './types'

export class RelayConsumer {
  private running = false

  constructor(
    private source: RelaySource,
    private handler: (msg: RelayMessage) => Promise<void>,
  ) {}

  async start(): Promise<void> {
    this.running = true
    console.log(`[RelayConsumer] Started (${this.source.type})`)

    while (this.running) {
      try {
        const messages = await this.source.poll(10)
        for (const msg of messages) {
          if (!this.running) break
          try {
            await this.handler(msg)
            await this.source.ack(msg.id)
          } catch (e) {
            console.error(`[RelayConsumer] Message handler failed:`, e)
            try {
              await this.source.nack?.(msg.id)
            } catch (nackErr) {
              console.error(`[RelayConsumer] Nack failed:`, nackErr)
            }
          }
        }
      } catch (e) {
        if (!this.running) break
        console.error(`[RelayConsumer] Poll error, retrying in 5s:`, e)
        await new Promise((r) => setTimeout(r, 5000))
      }
    }

    console.log(`[RelayConsumer] Stopped (${this.source.type})`)
  }

  async stop(): Promise<void> {
    this.running = false
    await this.source.close()
  }
}
