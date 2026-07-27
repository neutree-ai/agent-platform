import { describe, expect, it } from 'vitest'
import { buildSessionListWhere } from './sessions'

describe('buildSessionListWhere', () => {
  it('scopes to the workspace and active sessions when unfiltered', () => {
    const { where, params } = buildSessionListWhere('ws-1', undefined)
    expect(where).toBe(`s.workspace_id = $1 AND s.status = 'active'`)
    expect(params).toEqual(['ws-1'])
  })

  it('numbers placeholders in the order params are pushed', () => {
    const { where, params } = buildSessionListWhere('ws-1', {
      excludeSources: ['schedule'],
      statuses: ['human'],
      activeAfter: '2026-07-01T00:00:00.000Z',
    })
    expect(where).toContain('s.source <> ALL($2)')
    expect(where).toContain('= ANY($3)')
    expect(where).toContain('s.last_active_at >= $4')
    expect(params).toEqual(['ws-1', ['schedule'], ['human'], '2026-07-01T00:00:00.000Z'])
  })

  it('keeps placeholder numbering dense when earlier facets are absent', () => {
    // The page query appends LIMIT/OFFSET after these params, so a gap here
    // would shift them and silently mis-page the list.
    const { where, params } = buildSessionListWhere('ws-1', {
      activeAfter: '2026-07-01T00:00:00.000Z',
    })
    expect(where).toContain('s.last_active_at >= $2')
    expect(params).toHaveLength(2)
  })

  it('treats an empty facet selection as no filter', () => {
    const { where, params } = buildSessionListWhere('ws-1', {
      excludeSources: [],
      statuses: [],
      starredOnly: false,
    })
    expect(where).toBe(`s.workspace_id = $1 AND s.status = 'active'`)
    expect(params).toEqual(['ws-1'])
  })

  it('filters starred without consuming a placeholder', () => {
    const { where, params } = buildSessionListWhere('ws-1', { starredOnly: true })
    expect(where).toContain('s.starred_at IS NOT NULL')
    expect(params).toEqual(['ws-1'])
  })
})
