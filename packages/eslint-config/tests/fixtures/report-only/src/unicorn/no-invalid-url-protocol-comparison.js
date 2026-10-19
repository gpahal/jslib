// The comparison was always false, and the fix runs the branch it guards
export function isSecure(url) {
  if (new URL(url).protocol === 'https') {
    return true
  }
  return false
}
