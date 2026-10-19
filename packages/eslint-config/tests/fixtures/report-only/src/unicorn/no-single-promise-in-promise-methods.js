// `Promise.any` rejects with an `AggregateError`, and awaiting the promise with its own error
export async function first(promise) {
  return await Promise.any([promise])
}
