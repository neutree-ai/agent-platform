import { PgBoss } from 'pg-boss'
import { pool } from '../db/pool'
import { setEnqueueFn } from './index'

const QUEUE_NAME = 'notification-deliver'

let boss: PgBoss

/** Initialize the notification queue (send-only, worker runs in scheduler) */
export async function initNotificationQueue() {
  boss = new PgBoss({
    db: { executeSql: async (text: string, values?: unknown[]) => pool.query(text, values) },
  })

  boss.on('error', (err: Error) => console.error('[Notifications] pg-boss error:', err))

  await boss.start()

  await boss
    .createQueue(QUEUE_NAME, {
      retryLimit: 2,
      retryDelay: 30,
      expireInSeconds: 300,
      retentionSeconds: 7 * 24 * 3600,
    })
    .catch(() => {})

  // Wire up auto-enqueue so notify() triggers delivery
  setEnqueueFn(enqueueNotification)

  console.log('[Notifications] Queue initialized (send-only, worker runs in scheduler)')
}

/** Enqueue a notification for delivery */
async function enqueueNotification(notificationId: string) {
  await boss.send(QUEUE_NAME, { notificationId })
}
