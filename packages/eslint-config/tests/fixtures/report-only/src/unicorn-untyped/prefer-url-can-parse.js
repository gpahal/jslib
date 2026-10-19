// `URL.canParse` is newer than `URL`, and an older runtime lacks it
export function isUrl(value) {
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}
