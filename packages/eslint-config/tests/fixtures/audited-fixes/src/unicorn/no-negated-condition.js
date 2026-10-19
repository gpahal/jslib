/* eslint unicorn/no-negated-condition: "error" */
export function pick(a, b, c) {
  return !a ? b : c
}
