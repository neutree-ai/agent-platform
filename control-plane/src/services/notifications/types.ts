export interface NotificationPayload {
  title?: string
  body: string
  format?: 'text' | 'markdown' | 'html'
  type?: 'info' | 'success' | 'warning' | 'failure'
  attach?: string[]
  url?: string
  metadata?: Record<string, unknown>
}
