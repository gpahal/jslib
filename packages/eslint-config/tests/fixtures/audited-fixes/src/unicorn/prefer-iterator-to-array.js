/* eslint unicorn/prefer-iterator-to-array: "error" */
export function keys(map) {
  return [...Iterator.from(map.keys())]
}
