import { describe, expect, it } from 'vitest'
import { isComposingKey, shouldSubmitOnKey } from './keys'

function key(
  overrides: Partial<{
    key: string
    metaKey: boolean
    ctrlKey: boolean
    shiftKey: boolean
    isComposing: boolean
    keyCode: number
  }> = {},
) {
  return { key: 'Enter', metaKey: false, ctrlKey: false, shiftKey: false, ...overrides }
}

describe('isComposingKey', () => {
  it('detects isComposing on native and synthetic events', () => {
    expect(isComposingKey(key({ isComposing: true }))).toBe(true)
    expect(isComposingKey({ ...key(), nativeEvent: { isComposing: true } })).toBe(true)
  })

  it('detects the legacy 229 keyCode', () => {
    expect(isComposingKey(key({ keyCode: 229 }))).toBe(true)
  })

  it('is false for a plain key', () => {
    expect(isComposingKey(key())).toBe(false)
  })
})

describe('shouldSubmitOnKey', () => {
  describe('mod-enter', () => {
    it('submits on Cmd/Ctrl+Enter', () => {
      expect(shouldSubmitOnKey(key({ metaKey: true }), 'mod-enter')).toBe(true)
      expect(shouldSubmitOnKey(key({ ctrlKey: true }), 'mod-enter')).toBe(true)
    })

    it('keeps Enter and Shift+Enter as newlines', () => {
      expect(shouldSubmitOnKey(key(), 'mod-enter')).toBe(false)
      expect(shouldSubmitOnKey(key({ shiftKey: true }), 'mod-enter')).toBe(false)
      expect(shouldSubmitOnKey(key({ metaKey: true, shiftKey: true }), 'mod-enter')).toBe(false)
    })
  })

  describe('enter', () => {
    it('submits on plain Enter', () => {
      expect(shouldSubmitOnKey(key(), 'enter')).toBe(true)
    })

    it('keeps Shift+Enter and Cmd/Ctrl+Enter as newlines', () => {
      expect(shouldSubmitOnKey(key({ shiftKey: true }), 'enter')).toBe(false)
      expect(shouldSubmitOnKey(key({ metaKey: true }), 'enter')).toBe(false)
      expect(shouldSubmitOnKey(key({ ctrlKey: true }), 'enter')).toBe(false)
    })

    it('treats Enter as a newline on touch-first devices', () => {
      expect(shouldSubmitOnKey(key(), 'enter', { touch: true })).toBe(false)
      expect(shouldSubmitOnKey(key({ metaKey: true }), 'enter', { touch: true })).toBe(true)
    })
  })

  it('never submits while composing', () => {
    expect(shouldSubmitOnKey(key({ isComposing: true }), 'enter')).toBe(false)
    expect(shouldSubmitOnKey(key({ metaKey: true, keyCode: 229 }), 'mod-enter')).toBe(false)
  })

  it('ignores other keys', () => {
    expect(shouldSubmitOnKey(key({ key: 'a', metaKey: true }), 'mod-enter')).toBe(false)
  })
})
