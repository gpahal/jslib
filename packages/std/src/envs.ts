/**
 * Where the code runs. Contract: read once, when the module loads, from globals that any code that
 * ran before can change
 */

const nodeProcess: unknown = Reflect.get(globalThis, 'process')

/**
 * Whether the code runs on Windows in Node or another runtime with a Node-like `process`. `false` in
 * browsers. Read once, when the module loads
 */
export const isWindows: boolean =
  typeof nodeProcess === 'object' &&
  nodeProcess !== null &&
  'platform' in nodeProcess &&
  nodeProcess.platform === 'win32'

const browserDocument: unknown = Reflect.get(globalThis, 'document')

/**
 * Whether a global `document` exists, as in a browser's main thread or Node under jsdom or
 * happy-dom. `false` in workers, Deno and edge runtimes. Read once, when the module loads
 *
 * @example
 * ```ts
 * import { hasDocument } from '@gpahal/std/envs'
 *
 * const title = hasDocument ? document.title : undefined
 * ```
 */
export const hasDocument: boolean = browserDocument != null

/**
 * Whether a global `document` exists. Despite its name, it's `false` in workers
 *
 * @deprecated Use {@link hasDocument}, which this equals, or {@link isWebWorker}.
 */
export const isBrowser: boolean = browserDocument != null

function isWorkerGlobalScope(): boolean {
  const WorkerGlobalScope: unknown = Reflect.get(globalThis, 'WorkerGlobalScope')
  if (typeof WorkerGlobalScope !== 'function') {
    return false
  }
  // A `Symbol.hasInstance` of a stand-in can throw, and reading the environment never throws
  try {
    return globalThis instanceof WorkerGlobalScope
  } catch {
    return false
  }
}

/**
 * Whether the global object is a `WorkerGlobalScope`, as in a dedicated, shared or service worker.
 * `false` in a browser's main thread and in Node. Read once, when the module loads
 *
 * @example
 * ```ts
 * import { isWebWorker } from '@gpahal/std/envs'
 *
 * const scope = isWebWorker ? 'worker' : 'main'
 * ```
 */
export const isWebWorker: boolean = isWorkerGlobalScope()
