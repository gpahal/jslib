// Without semicolons, removing `void` joins the statement to the line before: `record()` then
// `(isA ? a : b)()` is the call `record()(isA ? a : b)()`
export function run(record: () => void, isA: boolean, a: () => void, b: () => void): void {
  record()
  void (isA ? a : b)()
}
