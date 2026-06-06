import { beforeEach, describe, expect, test } from 'vitest'
import { useDraftStore } from './draft-store'

beforeEach(() => {
  useDraftStore.setState({ drafts: {} })
})

describe('draft-store', () => {
  test('setDraft stores a draft by key', () => {
    useDraftStore.getState().setDraft('ws1:sess1', 'hello')
    expect(useDraftStore.getState().drafts).toEqual({ 'ws1:sess1': 'hello' })
  })

  test('setDraft overwrites existing draft', () => {
    useDraftStore.getState().setDraft('ws1:sess1', 'hello')
    useDraftStore.getState().setDraft('ws1:sess1', 'updated')
    expect(useDraftStore.getState().drafts['ws1:sess1']).toBe('updated')
  })

  test('multiple sessions have independent drafts', () => {
    const { setDraft } = useDraftStore.getState()
    setDraft('ws1:sess1', 'draft A')
    setDraft('ws1:sess2', 'draft B')
    setDraft('ws2:sess1', 'draft C')

    const { drafts } = useDraftStore.getState()
    expect(drafts).toEqual({
      'ws1:sess1': 'draft A',
      'ws1:sess2': 'draft B',
      'ws2:sess1': 'draft C',
    })
  })

  test('clearDraft removes only the target key', () => {
    const { setDraft } = useDraftStore.getState()
    setDraft('ws1:sess1', 'keep')
    setDraft('ws1:sess2', 'remove')

    useDraftStore.getState().clearDraft('ws1:sess2')

    expect(useDraftStore.getState().drafts).toEqual({ 'ws1:sess1': 'keep' })
  })

  test('clearDraft on non-existent key is a no-op', () => {
    useDraftStore.getState().setDraft('ws1:sess1', 'hello')
    useDraftStore.getState().clearDraft('ws1:missing')
    expect(useDraftStore.getState().drafts).toEqual({ 'ws1:sess1': 'hello' })
  })

  test('setDraft with empty string stores it (not treated as clear)', () => {
    useDraftStore.getState().setDraft('ws1:sess1', '')
    expect(useDraftStore.getState().drafts).toHaveProperty('ws1:sess1', '')
  })
})
