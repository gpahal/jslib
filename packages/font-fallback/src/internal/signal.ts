/**
 * The parts of a signal that are read. A signal of another realm or a polyfill can lack `reason`
 * and `throwIfAborted` and fail `instanceof AbortSignal`, and Node's `fetch` and streams take only
 * a native one
 */
type SignalSource = {
  aborted: boolean
  reason?: unknown
  addEventListener: (type: 'abort', listener: () => void) => void
  removeEventListener: (type: 'abort', listener: () => void) => void
}

/**
 * Whether `value` has what {@link linkSignal} reads
 */
export function isSignalLike(value: unknown): boolean {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof Reflect.get(value, 'aborted') === 'boolean' &&
    typeof Reflect.get(value, 'addEventListener') === 'function' &&
    typeof Reflect.get(value, 'removeEventListener') === 'function'
  )
}

export type LinkedSignal = {
  signal: AbortSignal | undefined
  unlink: () => void
}

/**
 * A native signal that aborts with `source`'s reason when `source` aborts, or at once if it has.
 * An `undefined` reason, as from a polyfill, becomes the `AbortError` a native `abort()` gives.
 * Call `unlink` once the work ends, so `source` holds no listener of this call
 */
export function linkSignal(source: SignalSource | undefined): LinkedSignal {
  if (source === undefined) {
    return { signal: undefined, unlink: () => undefined }
  }
  const controller = new AbortController()
  const abort = (): void => {
    controller.abort(source.reason)
  }
  // Added before `aborted` is read, so no abort goes unseen; a second `abort()` does nothing. No
  // options, as a polyfill can read a third argument as `useCapture` and fail to remove the listener
  source.addEventListener('abort', abort)
  if (source.aborted) {
    abort()
  }
  return {
    signal: controller.signal,
    unlink: () => {
      source.removeEventListener('abort', abort)
    },
  }
}
