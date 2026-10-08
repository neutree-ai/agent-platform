import { randomUUID } from 'node:crypto'
import {
  adoptSessionTurn as adoptInDb,
  claimSessionTurn as claimInDb,
  releaseSessionTurn,
  renewSessionTurn,
} from '../db/sessions'

// One turn per session. The agent keys a turn's event handler and output sink
// by session id, and cp keys its live stream the same way, so two turns in one
// session tear each other down: whichever ends first unregisters the other's
// handler, and the later one replaces the earlier one's stream before its reply
// is stored. A client holds back its own sends while its turn runs, but another
// client of the same session — a second tab, a teammate in a shared workspace,
// a schedule — cannot see that, so the rule is enforced here.
//
// The claim is a lease on the session row, so it holds across replicas. The
// replica running the turn renews it until the turn ends or the process exits;
// after that the lease runs out and the session frees itself, unless the
// replica recovering the turn has adopted it first.

/** How long a claim lasts without renewal. */
const CLAIM_TTL_SECONDS = 60
/** How often the holder renews it. */
const CLAIM_RENEW_MS = 20_000

interface SessionTurnClaim {
  /**
   * The turn is over: stop renewing and free the session. Resolves once the
   * session is free, so a follow-up turn dispatched afterwards can claim it.
   * Safe to repeat. Never rejects.
   */
  release(): Promise<void>
}

function hold(sessionId: string, token: string): SessionTurnClaim {
  let timer: ReturnType<typeof setInterval> | undefined = setInterval(() => {
    renewSessionTurn(sessionId, token, CLAIM_TTL_SECONDS)
      .then((held) => {
        // Taken over by a recovering replica: this one no longer owns the turn.
        if (!held) stop()
      })
      .catch((e) => console.warn(`[session-turn] renew failed session=${sessionId}:`, e))
  }, CLAIM_RENEW_MS)
  timer.unref?.()
  const stop = () => {
    if (!timer) return false
    clearInterval(timer)
    timer = undefined
    return true
  }
  return {
    async release() {
      if (!stop()) return
      await releaseSessionTurn(sessionId, token).catch((e) =>
        console.warn(`[session-turn] release failed session=${sessionId}:`, e),
      )
    },
  }
}

/**
 * Claim the session for a new turn. Null when a turn is running in it —
 * including one parked on a question, which has not ended: the way on is to
 * answer it or stop it.
 */
export async function claimSessionTurn(sessionId: string): Promise<SessionTurnClaim | null> {
  const token = randomUUID()
  return (await claimInDb(sessionId, token, CLAIM_TTL_SECONDS)) ? hold(sessionId, token) : null
}

/**
 * Claim a session whose turn this replica already runs: one the turn has just
 * created, or one being recovered after a restart.
 */
export async function adoptSessionTurn(sessionId: string): Promise<SessionTurnClaim> {
  const token = randomUUID()
  await adoptInDb(sessionId, token, CLAIM_TTL_SECONDS)
  return hold(sessionId, token)
}
