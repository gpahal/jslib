// `reduce` throws for an empty array without an initial value, where the loop leaves `undefined`
/* eslint unicorn/no-array-reduce: "error" */
export function max(list) {
  const values = list.filter(Boolean)
  const largest = values.reduce((a, b) => Math.max(a, b))
  return largest
}
