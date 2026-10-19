// `find` stops at the first match, so the predicate's side effects run fewer times
export function firstLarge(values, seen) {
  return values.filter((value) => {
    seen.count += 1
    return value > 1
  })[0]
}
