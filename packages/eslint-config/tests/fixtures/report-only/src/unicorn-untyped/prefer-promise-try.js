// `Promise.try` is ES2025, which an older runtime lacks
export function run(task) {
  return new Promise((resolve) => {
    resolve(task())
  })
}
