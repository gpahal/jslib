// A stream's `map` takes options as its second argument
export function double(readable, options) {
  return readable.map((value) => value * 2, options)
}
