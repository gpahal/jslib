// `globalThis` always exists, and `window` throws where it doesn't
export function isBrowser() {
  try {
    return Boolean(window)
  } catch {
    return false
  }
}
