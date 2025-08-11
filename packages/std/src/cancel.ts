/**
 * A cancel signal is similar to an AbortSignal. It allows you to check for cancellation and
 * register a callback that will be called when the signal is cancelled.
 *
 * @example
 * ```ts
 * async function doSomething() {
 *   const onCancel = () => {
 *     throw new Error('Cancelled')
 *   }
 *   cancelSignal.onCancelled(onCancel)
 *
 *   try {
 *     // ... do work
 *   } finally {
 *     cancelSignal.clearOnCancelled(onCancel)
 *   }
 * }
 * ```
 */
export type CancelSignal = {
  /**
   * Register a callback that will be called when the signal is cancelled.
   *
   * @param fn - The callback to register.
   */
  onCancelled: (fn: () => void) => void
  /**
   * Clear a callback that was registered with `onCancelled`.
   *
   * @param fn - The callback to clear. Should be the same function that was registered with
   * `onCancelled`.
   */
  clearOnCancelled: (fn: () => void) => void
  /**
   * Check if the signal is cancelled.
   *
   * @returns `true` if the signal is cancelled, `false` otherwise.
   */
  isCancelled: () => boolean
}

/**
 * Create a cancel signal.
 *
 * @example
 * ```ts
 * const [cancelSignal, cancel] = createCancelSignal()
 * ```
 *
 * @param options - The options for the cancel signal.
 * @param options.abortSignal - An optional abort signal. If provided, the cancel signal will be
 *   cancelled when the abort signal is aborted.
 * @returns A tuple containing the cancel signal and a function to cancel the signal.
 */
export function createCancelSignal({
  abortSignal,
}: {
  abortSignal?: AbortSignal
} = {}): [CancelSignal, () => void] {
  let isCancelled = abortSignal?.aborted ?? false
  const subscribers = new Set<() => void>()
  const cancel = () => {
    if (abortSignal) {
      abortSignal.removeEventListener('abort', cancel)
    }
    if (isCancelled) {
      return
    }

    isCancelled = true
    for (const fn of subscribers) {
      try {
        fn()
      } catch {
        // Ignore errors in subscribers
      }
    }
    subscribers.clear()
  }

  if (abortSignal) {
    abortSignal.addEventListener('abort', cancel)
  }

  const cancelSignal: CancelSignal = {
    onCancelled: (fn) => {
      if (isCancelled) {
        fn()
      } else {
        subscribers.add(fn)
      }
    },
    clearOnCancelled: (fn) => {
      subscribers.delete(fn)
    },
    isCancelled: () => isCancelled,
  }
  return [cancelSignal, cancel]
}

/**
 * Create a cancel signal that will be cancelled after a timeout.
 *
 * @param timeoutMs - The timeout in milliseconds.
 * @param options - The options for the cancel signal.
 * @returns A cancel signal.
 */
export function createTimeoutCancelSignal(timeoutMs: number): CancelSignal {
  const [cancelSignal, cancel] = createCancelSignal()
  setTimeout(() => cancel(), timeoutMs)
  return cancelSignal
}

/**
 * Create a cancellable promise. If a signal is provided, the promise will be rejected with a
 * `Error` if the signal is cancelled.
 *
 * @example
 * ```ts
 * const [cancelSignal, cancel] = createCancelSignal()
 * const promise = createCancellablePromise(doSomething(), cancelSignal)
 *
 * cancel() // Cancels the promise if it is not already resolved
 * ```
 *
 * @param promise - The promise to cancel.
 * @param signal - A signal to cancel the promise.
 * @param cancelledError - An optional error to use when the promise is cancelled. If not provided,
 *   an `Error` will be used.
 * @returns A promise that will be rejected with a `Error` if the signal is cancelled.
 */
export function createCancellablePromise<T>(
  promise: Promise<T>,
  signal?: CancelSignal,
  cancelledError?: Error,
): Promise<T> {
  if (!signal) {
    return promise
  }

  const getCancelledError = () => {
    if (cancelledError) {
      return cancelledError
    }
    return new Error('Cancelled')
  }

  return new Promise((resolve, reject) => {
    if (signal.isCancelled()) {
      reject(getCancelledError())
      return
    }

    const onCancelled = () => {
      reject(getCancelledError())
    }

    signal.onCancelled(onCancelled)

    promise.then(resolve, reject).finally(() => {
      signal.clearOnCancelled(onCancelled)
    })
  })
}
