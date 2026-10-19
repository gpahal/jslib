// `Promise.resolve(promise)` returns `promise` itself, and the new promise that adopts it settles
// two microtasks later
export function wrap(promise) {
  return new Promise((resolve) => resolve(promise))
}
