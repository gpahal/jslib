export function parse(text) {
  try {
    return JSON.parse(text)
  } catch (error) {
    return undefined
  }
}
