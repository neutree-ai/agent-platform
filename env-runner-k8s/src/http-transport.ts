import type {
  ObservedUpdate,
  PlacementRow,
  PlacementTransport,
} from '../../internal/env-runner-core'

// Remote (BYOI) transport: speaks the /env/v1 protocol to cp, authenticated by a
// per-environment token. cp scopes every call to that token's environment, so
// this transport never sends an environment id — the server already knows it.
// The runner is behind NAT and only dials out; all calls here are outbound.
export class HttpTransport implements PlacementTransport {
  private readonly base: string

  constructor(
    cpUrl: string,
    private readonly token: string,
  ) {
    this.base = cpUrl.replace(/\/+$/, '')
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.token}`, 'content-type': 'application/json' }
  }

  private async expectOk(res: Response, what: string): Promise<void> {
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`${what} → ${res.status} ${body}`)
    }
  }

  async listPlacements(): Promise<PlacementRow[]> {
    const res = await fetch(`${this.base}/env/v1/placements`, { headers: this.headers() })
    await this.expectOk(res, 'GET /env/v1/placements')
    const body = (await res.json()) as { placements: PlacementRow[] }
    return body.placements
  }

  async writeObserved(workspaceId: string, o: ObservedUpdate): Promise<void> {
    const res = await fetch(
      `${this.base}/env/v1/placements/${encodeURIComponent(workspaceId)}/observed`,
      { method: 'POST', headers: this.headers(), body: JSON.stringify(o) },
    )
    await this.expectOk(res, 'POST observed')
  }

  async deletePlacement(workspaceId: string): Promise<void> {
    const res = await fetch(
      `${this.base}/env/v1/placements/${encodeURIComponent(workspaceId)}/delete`,
      { method: 'POST', headers: this.headers() },
    )
    await this.expectOk(res, 'POST delete')
  }

  async heartbeat(capabilities: Record<string, unknown>): Promise<void> {
    const res = await fetch(`${this.base}/env/v1/heartbeat`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ capabilities }),
    })
    await this.expectOk(res, 'POST heartbeat')
  }
}
