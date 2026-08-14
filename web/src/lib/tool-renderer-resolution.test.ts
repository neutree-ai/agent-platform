import { resolveRenderer } from '@neutree-ai/ui-sdk'
import { describe, expect, it } from 'vitest'

/**
 * Tool names are not unique across cores: goose's `write` takes `{path,
 * content}` and dsh's takes `{file_path, content}`, so one shared entry keyed
 * by name alone renders whichever core it was not written for with a blank
 * filename. These cover the resolution order that keeps them apart.
 */
describe('resolveRenderer', () => {
  const dshWrite = { name: 'write', input: { file_path: 'a.txt', content: 'x' } }

  it('gives a shared tool name a per-core renderer', () => {
    const forDsh = resolveRenderer(dshWrite, 'dsh')
    const forGoose = resolveRenderer(dshWrite, 'goose')
    expect(forDsh).not.toBeNull()
    expect(forDsh).not.toBe(forGoose)
  })

  it('previews a dsh write with the path dsh actually sends', () => {
    // The goose renderer reads `input.path` and would preview an empty string.
    expect(resolveRenderer(dshWrite, 'dsh')?.getPreview(dshWrite)).toBe('a.txt')
  })

  it('falls through to the shared registry for names only one core uses', () => {
    // Platform MCP tools are the same tools for every core, so dsh must reach
    // the shared renderer rather than needing its own copy.
    const call = { name: 'mcp__platform__create_sandbox', input: {} }
    expect(resolveRenderer(call, 'dsh')).toBe(resolveRenderer(call, 'goose'))
    expect(resolveRenderer(call, 'dsh')).not.toBeNull()
  })

  it('leaves other cores untouched by the dsh entries', () => {
    const gooseWrite = { name: 'write', input: { path: 'b.txt', content: 'y' } }
    expect(resolveRenderer(gooseWrite, 'goose')?.getPreview(gooseWrite)).toBe('b.txt')
  })
})
