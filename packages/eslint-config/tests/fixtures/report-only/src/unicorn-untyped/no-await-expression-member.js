// `const [item] = list` iterates, where `list[0]` reads an index: a `Set` has no index, and an
// array-like without an iterator throws
/* eslint unicorn/no-await-expression-member: "error" */
export async function first(load) {
  const item = (await load())[0]
  return item
}
