import type { CancelSignal } from './cancel'

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

/**
 * Sleep for a given number of milliseconds.
 *
 * @example
 * ```ts
 * await sleep(1000)
 * ```
 *
 * @param ms - The number of milliseconds to sleep.
 * @param options - The options for the sleep.
 * @param options.jitterRatio - The ratio of jitter to add to the sleep time. Default is 0 or no
 *   jitter.
 * @param options.stopOnCancelSignal - A cancel signal to stop the sleep.
 * @returns A promise that resolves after the sleep time.
 */
export function sleep(
  ms: number,
  {
    jitterRatio = 0,
    stopOnCancelSignal,
  }: { jitterRatio?: number; stopOnCancelSignal?: CancelSignal } = {},
): Promise<void> {
  if (jitterRatio > 0) {
    ms = ms * (1 + jitterRatio * (Math.random() * 2 - 1))
  }

  if (!stopOnCancelSignal) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms)
    })
  }

  return new Promise((resolve) => {
    let timeout: NodeJS.Timeout | undefined
    const clear = () => {
      if (timeout) {
        clearTimeout(timeout)
        timeout = undefined
      }
    }

    stopOnCancelSignal.onCancelled(clear)

    timeout = setTimeout(() => {
      resolve()
      stopOnCancelSignal.clearOnCancelled(clear)
      timeout = undefined
    }, ms)
  })
}

/**
 * Sleep for a given number of milliseconds with a wakeup function.
 *
 * @example
 * ```ts
 * const [promise, wakeup] = sleepWithWakeup(1000)
 * await promise
 *
 * // Somewhere else
 * wakeup()
 *
 * // Or to reject with a reason
 * wakeup({ reject: true, rejectReason: new Error('Cancelled') })
 * ```
 *
 * @param ms - The number of milliseconds to sleep.
 * @param jitterRatio - The ratio of jitter to add to the sleep time. Default is 0 or no jitter.
 * @returns A promise that resolves after the sleep time and a wakeup function.
 */
export function sleepWithWakeup(
  ms: number,
  jitterRatio = 0,
): [Promise<void>, (options?: { reject?: boolean; rejectReason?: unknown }) => void] {
  let timeout: NodeJS.Timeout | undefined
  let resolve: ((value: void) => void) | undefined
  let reject: ((error: unknown) => void) | undefined

  const wakeup = (options: { reject?: boolean; rejectReason?: unknown } = {}) => {
    if (timeout) {
      clearTimeout(timeout)
      timeout = undefined
    }
    if (options.reject) {
      resolve = undefined
      if (reject) {
        reject(options.rejectReason)
        reject = undefined
      }
    } else if (resolve) {
      resolve()
      resolve = undefined
      reject = undefined
    } else {
      reject = undefined
    }
  }

  if (jitterRatio > 0) {
    ms = ms * (1 + jitterRatio * (Math.random() * 2 - 1))
  }
  const promise = new Promise<void>((resolveLocal, rejectLocal) => {
    resolve = resolveLocal
    reject = rejectLocal
    timeout = setTimeout(wakeup, ms)
  })

  return [promise, wakeup]
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
