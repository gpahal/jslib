import whyIsNodeRunning from 'why-is-node-running'

/**
 * Logs the active handles that prevent Node.js from exiting.
 *
 * @example
 * ```ts
 * import { logActiveHandles } from '@gpahal/std-node/process'
 *
 * setTimeout(() => {
 *   logActiveHandles()
 *   process.exit(0)
 * }, 5000)
 * ```
 */
export function logActiveHandles() {
  console.log('=> Active handles:\n')
  whyIsNodeRunning({
    error(message) {
      console.log(message)
    },
  })
}

/**
 * Waits for the process to exit for `timeoutMs` milliseconds or logs the active handles that
 * prevent Node.js from exiting and exits the process after the specified timeout.
 *
 * @example
 * ```ts
 * import { waitForExitOrLogActiveHandles } from '@gpahal/std-node/process'
 *
 * waitForExitOrLogActiveHandles(10_000)
 * ```
 *
 * @param timeoutMs - The timeout in milliseconds.
 */
export function waitForExitOrLogActiveHandles(timeoutMs = 5000) {
  const startTime = Date.now()
  let timeout: NodeJS.Timeout | undefined

  const setupTimeout = () => {
    timeout = setTimeout(() => {
      console.log(
        `\n⚠️ Script has been running for ${Math.ceil((Date.now() - startTime) / 1000)} seconds. Active handles keeping Node alive:`,
      )
      logActiveHandles()

      // eslint-disable-next-line unicorn/no-process-exit
      process.exit(1)
    }, timeoutMs)

    timeout.unref()
  }

  const clear = () => {
    if (timeout) {
      clearTimeout(timeout)
    }
  }

  process.on('beforeExit', clear)
  process.on('SIGINT', clear)
  process.on('SIGTERM', clear)

  setupTimeout()
}
