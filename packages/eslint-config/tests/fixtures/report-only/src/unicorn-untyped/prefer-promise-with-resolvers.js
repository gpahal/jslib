// `Promise.withResolvers` is ES2024, which an older runtime lacks
export function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolve_, reject_) => {
    resolve = resolve_
    reject = reject_
  })
  return { promise, resolve, reject }
}
