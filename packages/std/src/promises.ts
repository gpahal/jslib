export function isPromise<T = unknown>(value: unknown): value is Promise<T> {
  return value instanceof Promise
}

export function isPromiseLike<T = unknown>(value: unknown): value is PromiseLike<T> {
  return value != null && typeof value === 'object' && 'then' in value && typeof value.then === 'function'
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
