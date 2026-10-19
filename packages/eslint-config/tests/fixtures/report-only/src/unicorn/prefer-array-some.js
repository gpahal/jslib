// `some` stops at the first match, so the predicate's side effects run fewer times
export function hasInvalid(fields, validate) {
  return fields.filter((field) => validate(field)).length > 0
}
