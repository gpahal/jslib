// `test` with a global regex moves its `lastIndex`, and `match` doesn't
const PATTERN = /a/g

export function count(values) {
  let matches = 0
  for (const value of values) {
    if (value.match(PATTERN)) {
      matches += 1
    }
  }
  return matches
}
