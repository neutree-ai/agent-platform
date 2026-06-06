import { describe, expect, test } from 'vitest'
import { client } from './setup'

describe('tags CRUD', () => {
  let firstTagId: string
  let secondTagId: string

  test('create tag', async () => {
    const tag = await client.tags.create({ name: 'test-tag', color: 'emerald' })
    expect(tag.id).toBeTruthy()
    expect(tag.name).toBe('test-tag')
    expect(tag.color).toBe('emerald')
    firstTagId = tag.id
  })

  test('list tags contains created tag', async () => {
    const tags = await client.tags.list()
    const found = tags.find((t) => t.id === firstTagId)
    expect(found).toBeDefined()
    expect(found!.name).toBe('test-tag')
  })

  test('update tag name', async () => {
    const updated = await client.tags.update(firstTagId, { name: 'test-tag-renamed' })
    expect(updated.name).toBe('test-tag-renamed')

    const tags = await client.tags.list()
    const found = tags.find((t) => t.id === firstTagId)
    expect(found!.name).toBe('test-tag-renamed')
  })

  test('create second tag', async () => {
    const tag = await client.tags.create({ name: 'second-tag', color: 'sky' })
    expect(tag.id).toBeTruthy()
    expect(tag.name).toBe('second-tag')
    secondTagId = tag.id
  })

  test('delete first tag, only second remains', async () => {
    await client.tags.delete(firstTagId)

    const tags = await client.tags.list()
    const first = tags.find((t) => t.id === firstTagId)
    expect(first).toBeUndefined()

    const second = tags.find((t) => t.id === secondTagId)
    expect(second).toBeDefined()
    expect(second!.name).toBe('second-tag')

    // Clean up second tag
    await client.tags.delete(secondTagId)
  })
})
