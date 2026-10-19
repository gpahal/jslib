// `!options.size` is `true` for a missing `size`, and `options.size === 0` isn't
export function isEmpty(options) {
  return !options.size
}
