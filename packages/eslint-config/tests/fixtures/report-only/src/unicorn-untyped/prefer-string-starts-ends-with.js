// A `null` href gives `false` here, and `startsWith` throws
export function isHash(href) {
  return /^#/.test(href)
}
