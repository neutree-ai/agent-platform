import { describe, expect, it } from 'vitest'
import {
  MAX_CANVAS_AREA,
  MAX_CANVAS_DIMENSION,
  PREFERRED_RASTER_SCALE,
  computeRasterScale,
  parseViewBox,
} from './mermaid-export'

describe('parseViewBox', () => {
  it('reads the size out of a mermaid viewBox', () => {
    expect(parseViewBox('0 0 1406.019 5027.546')).toEqual({
      width: 1406.019,
      height: 5027.546,
    })
  })

  it('accepts comma separators', () => {
    expect(parseViewBox('0,0,100,50')).toEqual({ width: 100, height: 50 })
  })

  it('rejects missing, malformed and degenerate boxes', () => {
    expect(parseViewBox(null)).toBeNull()
    expect(parseViewBox('')).toBeNull()
    expect(parseViewBox('0 0 100')).toBeNull()
    expect(parseViewBox('0 0 100 abc')).toBeNull()
    expect(parseViewBox('0 0 0 50')).toBeNull()
    expect(parseViewBox('0 0 100 -50')).toBeNull()
  })
})

describe('computeRasterScale', () => {
  it('upscales a small diagram to the preferred factor', () => {
    expect(computeRasterScale({ width: 400, height: 300 })).toBe(PREFERRED_RASTER_SCALE)
  })

  it('clamps a tall diagram so no canvas edge exceeds the limit', () => {
    const size = { width: 1406, height: 5028 }
    const scale = computeRasterScale(size)
    expect(scale).toBeLessThan(PREFERRED_RASTER_SCALE)
    expect(size.height * scale).toBeLessThanOrEqual(MAX_CANVAS_DIMENSION)
    expect(size.width * scale * (size.height * scale)).toBeLessThanOrEqual(MAX_CANVAS_AREA + 1)
  })

  it('clamps on total area even when both edges fit', () => {
    const size = { width: 5000, height: 3000 }
    const scale = computeRasterScale(size)
    // +1 absorbs float drift; the canvas itself rounds to whole pixels.
    expect(size.width * scale * (size.height * scale)).toBeLessThanOrEqual(MAX_CANVAS_AREA + 1)
  })

  it('downscales a diagram whose natural size already exceeds the limits', () => {
    expect(computeRasterScale({ width: 20000, height: 12000 })).toBeLessThan(1)
  })

  it('honours explicit limits', () => {
    expect(
      computeRasterScale({ width: 100, height: 100 }, { preferred: 4, maxDimension: 200 }),
    ).toBe(2)
  })
})
