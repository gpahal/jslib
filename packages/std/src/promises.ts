export function isPromise<T = unknown>(value: unknown): value is Promise<T> {
  return value instanceof Promise
}

export function isPromiseLike<T = unknown>(value: unknown): value is PromiseLike<T> {
  return (
    value != null &&
    typeof value === 'object' &&
    'then' in value &&
    typeof value.then === 'function'
  )
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * A mutex returned by {@link createMutex}.
 */
export type Mutex = {
  acquire: () => Promise<void>
  release: () => void
}

/**
 * Create a mutex. Use this to run code that should not run in parallel.
 *
 * @example
 * ```ts
 * const mutex = createMutex()
 *
 * async function runSomethingSequentially() {
 *   await mutex.acquire()
 *   try {
 *     // ... run something that should not run in parallel with other things
 *   } finally {
 *     mutex.release()
 *   }
 * }
 * ```
 */
export function createMutex(): Mutex {
  let locked = false
  const waiting: Array<() => void> = []

  const acquire = (): Promise<void> => {
    return new Promise<void>((resolve) => {
      if (!locked) {
        locked = true
        resolve()
      } else {
        waiting.push(resolve)
      }
    })
  }

  const release = (): void => {
    if (waiting.length > 0) {
      const next = waiting.shift()!
      next()
    } else {
      locked = false
    }
  }

  return { acquire, release }
}
