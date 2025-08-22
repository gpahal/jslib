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

/**
 * A promise that can be tracked for its status. See {@link createTrackedPromise} for more details.
 */
export type TrackedPromise<T> = Promise<T> & {
  getStatus: () => 'pending' | 'resolved' | 'rejected'
  checkIfSettled: () => boolean
}

/**
 * Create a tracked promise.
 *
 * @example
 * ```ts
 * const promise = createTrackedPromise(new Promise((resolve) => setTimeout(resolve, 1000)))
 * console.log(promise.getStatus()) // 'pending'
 * await promise
 * console.log(promise.getStatus()) // 'resolved'
 * ```
 */
export function createTrackedPromise<T>(promise: Promise<T>): TrackedPromise<T> {
  let status = 'pending'

  const trackedPromise = promise
    .then((value) => {
      status = 'resolved'
      return value
    })
    .catch((error) => {
      status = 'rejected'
      throw error
    })

  // @ts-expect-error - This is intentional
  trackedPromise.getStatus = () => status
  // @ts-expect-error - This is intentional
  trackedPromise.checkIfSettled = () => status !== 'pending'

  return trackedPromise as TrackedPromise<T>
}

const PROMISE_FINISHED_SYMBOL = Symbol('PROMISE_FINISHED')

/**
 * Check if a promise has been settled.
 *
 * @example
 * ```ts
 * const promise = new Promise((resolve) => setTimeout(resolve, 1000))
 * console.log(await checkIfPromiseIsSettled(promise)) // false
 * await promise
 * console.log(await checkIfPromiseIsSettled(promise)) // true
 * ```
 */
export async function checkIfPromiseIsSettled(promise: Promise<unknown>): Promise<boolean> {
  const immediate = Promise.resolve(PROMISE_FINISHED_SYMBOL)
  try {
    const result = await Promise.race([promise, immediate])
    return result !== PROMISE_FINISHED_SYMBOL
  } catch {
    return true
  }
}
