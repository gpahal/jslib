/**
 * The optical size widths are read at. Under CSS's default `font-optical-sizing: auto`, browsers
 * set `opsz` to the font size in CSS px, and a fallback's `size-adjust` matches one size, so it's
 * that of 16px body text
 */
export const OPTICAL_SIZE = 16

/**
 * The metrics of font files with an `opsz` axis, and the results computed from them, kept off the
 * public objects so the CLI can note the optical size without a public field
 */
const readAtOpticalSize = new WeakSet<object>()

export function markReadAtOpticalSize(value: object): void {
  readAtOpticalSize.add(value)
}

export function isReadAtOpticalSize(value: object): boolean {
  return readAtOpticalSize.has(value)
}
