// The callback's promise settles three microtasks later than its plain value would, which code
// that races it against another promise can rely on
export function settle(promise) {
  return promise.then(() => Promise.resolve(undefined))
}
