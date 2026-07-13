import { Hono } from 'hono'
import type { AppEnv } from '../../lib/types'
import cluster from './cluster'
import stats from './stats'
import systemSettings from './system-settings'
import users from './users'
import workspaces from './workspaces'

const admin = new Hono<AppEnv>()

// Admin middleware — require role = 'admin'. Applies to every sub-router.
admin.use('*', async (c, next) => {
  const user = c.get('user')
  if (user.role !== 'admin') {
    return c.json({ error: 'Forbidden' }, 403)
  }
  return next()
})

admin.route('/stats', stats)
admin.route('/cluster', cluster)
admin.route('/users', users)
admin.route('/workspaces', workspaces)
admin.route('/system-settings', systemSettings)

export default admin
