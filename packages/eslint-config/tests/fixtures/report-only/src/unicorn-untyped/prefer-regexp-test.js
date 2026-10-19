// `name.match(re)` throws for a `null` name, and `re.test(null)` tests the string `'null'`
export function isDraft(name) {
  return Boolean(name.match(/^draft-/))
}
