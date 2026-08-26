/**
 * Export helpers for rendered mermaid diagrams (see `components/ui/mermaid-diagram.tsx`).
 *
 * Mermaid serializes its output as HTML, not XML: `htmlLabels` mode wraps
 * labels in `<foreignObject>` markup containing void tags such as `<br>`, and
 * the root `<svg>` carries `width="100%"` with no height. Browsers parse
 * `image/svg+xml` strictly, so that string fails to load in an `<img>` (which
 * is how a PNG raster is produced) and opens with a parser error when saved as
 * a `.svg` file. A percentage width also leaves the image at the 300x150
 * default intrinsic box, so anything rasterized from it comes out at a fixed
 * tiny size regardless of how large the diagram is.
 *
 * `normalizeSvg` re-serializes the markup as XML and pins the dimensions from
 * the viewBox, which makes both export formats correct.
 */

/** Longest canvas edge we ask a browser for. Beyond this `toBlob` returns null. */
export const MAX_CANVAS_DIMENSION = 8192
/** Total canvas pixels we ask a browser for; iOS Safari gives up around 16.7M. */
export const MAX_CANVAS_AREA = 16_700_000
/** Upscale factor for a diagram small enough to afford it. */
export const PREFERRED_RASTER_SCALE = 3

interface SvgSize {
  width: number
  height: number
}

/** Reads the intrinsic size out of a `viewBox` attribute, or null if unusable. */
export function parseViewBox(viewBox: string | null | undefined): SvgSize | null {
  if (!viewBox) return null
  const parts = viewBox
    .trim()
    .split(/[\s,]+/)
    .map(Number)
  if (parts.length !== 4) return null
  const [, , width, height] = parts
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }
  return { width, height }
}

/**
 * Picks a raster scale that keeps the canvas inside browser limits.
 *
 * Diagrams larger than the limits scale below 1 — a downscaled PNG beats the
 * blank canvas a browser hands back when the requested size is refused.
 */
export function computeRasterScale(
  { width, height }: SvgSize,
  {
    preferred = PREFERRED_RASTER_SCALE,
    maxDimension = MAX_CANVAS_DIMENSION,
    maxArea = MAX_CANVAS_AREA,
  }: { preferred?: number; maxDimension?: number; maxArea?: number } = {},
): number {
  const scale = Math.min(
    preferred,
    maxDimension / width,
    maxDimension / height,
    Math.sqrt(maxArea / (width * height)),
  )
  return scale > 0 ? scale : 1
}

/**
 * Re-serializes mermaid's HTML-flavoured SVG as XML and pins width/height from
 * the viewBox. Returns the input untouched when the DOM APIs are unavailable.
 */
export function normalizeSvg(svg: string): string {
  if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') return svg
  const element = new DOMParser().parseFromString(svg, 'text/html').querySelector('svg')
  if (!element) return svg
  const size = parseViewBox(element.getAttribute('viewBox'))
  if (size) {
    element.setAttribute('width', String(size.width))
    element.setAttribute('height', String(size.height))
    // mermaid caps the rendered width for responsive layout; an exported file
    // should be its natural size.
    element.style.removeProperty('max-width')
    if (!element.getAttribute('style')) element.removeAttribute('style')
  }
  return new XMLSerializer().serializeToString(element)
}

function toDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Failed to load the diagram as an image'))
    image.src = dataUrl
  })
}

function rasterize(image: HTMLImageElement, size: SvgSize, scale: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(size.width * scale))
    canvas.height = Math.max(1, Math.round(size.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      reject(new Error('Failed to create a 2D canvas context'))
      return
    }
    // SVG paints no background of its own; without this the PNG is transparent
    // and unreadable in any viewer that defaults to a dark backdrop.
    ctx.fillStyle = getComputedStyle(document.body).backgroundColor || '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Failed to encode the diagram as PNG'))
    }, 'image/png')
  })
}

/** Rasterizes a rendered mermaid SVG to a PNG blob. */
export async function svgToPngBlob(svg: string): Promise<Blob> {
  const normalized = normalizeSvg(svg)
  const image = await loadImage(toDataUrl(normalized))
  const size: SvgSize =
    image.naturalWidth > 0 && image.naturalHeight > 0
      ? { width: image.naturalWidth, height: image.naturalHeight }
      : { width: image.width, height: image.height }
  const scale = computeRasterScale(size)
  try {
    return await rasterize(image, size, scale)
  } catch (err) {
    // A browser can still refuse a canvas that our limits considered fine
    // (memory pressure, a stricter mobile cap). One retry at natural size
    // turns "nothing happened" into a usable, if smaller, export.
    if (scale <= 1) throw err
    return rasterize(image, size, 1)
  }
}

/** Triggers a browser download for generated content. */
export function downloadFile(filename: string, data: Blob | string, mimeType: string): void {
  const blob = typeof data === 'string' ? new Blob([data], { type: mimeType }) : data
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
