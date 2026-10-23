import type { LookupAddress, LookupAllOptions } from 'node:dns'
import dns from 'node:dns/promises'
import { getEventListeners, once } from 'node:events'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { pathToFileURL } from 'node:url'
import { runInNewContext, runInThisContext } from 'node:vm'

import { getFontFallbacks } from '@/index'

import { FIGTREE_PATH } from './fixtures'

const FILE_OPTIONS = { name: 'Figtree', fallbacks: ['Arial'] }
const FONT_URL = 'https://fonts.example/f.ttf'

const hooks = vi.hoisted(() => ({ afterOpen: undefined as (() => void) | undefined }))
vi.mock(import('node:fs/promises'), async (importOriginal) => {
  const fs = await importOriginal()
  return {
    ...fs,
    open: async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args)
      hooks.afterOpen?.()
      return handle
    },
  }
})

// FONT_URL's host, which doesn't exist, resolves to example.com's address
vi.spyOn(
  dns as {
    lookup: (hostname: string, options: LookupAllOptions) => Promise<Array<LookupAddress>>
  },
  'lookup',
).mockResolvedValue([{ address: '93.184.215.14', family: 4 }])

afterEach(() => {
  hooks.afterOpen = undefined
})

type TestController = {
  signal: AbortSignal
  abort: () => void
  reason: unknown
  listenerCount: () => number
}

/**
 * A polyfill like `abortcontroller-polyfill`: its own listeners, no `reason` or `throwIfAborted`,
 * and a third `addEventListener` argument read as `useCapture`, so a listener added with options
 * is removed only with them
 */
const POLYFILL = `
(withReason) => {
  const listeners = []
  const signal = {
    aborted: false,
    addEventListener(type, listener, capture) {
      listeners.push({ type, listener, capture: Boolean(capture) })
    },
    removeEventListener(type, listener, capture) {
      const index = listeners.findIndex(
        (entry) => entry.type === type && entry.listener === listener && entry.capture === Boolean(capture),
      )
      if (index !== -1) listeners.splice(index, 1)
    },
  }
  const reason = withReason ? new Error('polyfill abort') : undefined
  return {
    signal,
    reason,
    listenerCount: () => listeners.length,
    abort() {
      if (signal.aborted) return
      signal.aborted = true
      if (withReason) signal.reason = reason
      for (const { type, listener } of [...listeners]) {
        if (type === 'abort') listener.call(signal, { type: 'abort' })
      }
    },
  }
}
`

type PolyfillFactory = (withReason: boolean) => TestController

const createPolyfill = runInThisContext(POLYFILL) as PolyfillFactory

function createNativeController(): TestController {
  const controller = new AbortController()
  const reason = new Error('native abort')
  return {
    signal: controller.signal,
    reason,
    abort: () => {
      controller.abort(reason)
    },
    listenerCount: () => getEventListeners(controller.signal, 'abort').length,
  }
}

const SIGNALS: ReadonlyArray<[string, () => TestController]> = [
  ['a native signal', createNativeController],
  ['a polyfill of another realm', () => (runInNewContext(POLYFILL) as PolyfillFactory)(true)],
]

/**
 * The value a promise rejects with, which needn't be an `Error` of this realm
 */
async function getReason(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  expect.unreachable('expected the promise to reject')
}

describe.each(SIGNALS)('%s', (_, createController) => {
  it('rejects with its reason when aborted before the call or during the lookups', async () => {
    const early = createController()
    early.abort()
    await expect(getReason(getFontFallbacks('Inter', { signal: early.signal }))).resolves.toBe(
      early.reason,
    )
    const late = createController()
    const looking = getFontFallbacks('Figtree', { signal: late.signal })
    late.abort()
    await expect(getReason(looking)).resolves.toBe(late.reason)
    expect(early.listenerCount() + late.listenerCount()).toBe(0)
  })

  it('completes, and removes its listener', async () => {
    const controller = createController()
    await getFontFallbacks(pathToFileURL(FIGTREE_PATH), {
      ...FILE_OPTIONS,
      signal: controller.signal,
    })
    expect(controller.listenerCount()).toBe(0)
  })
})

describe('a native signal', () => {
  it('rejects with its reason when aborted while a file is read', async () => {
    const controller = createNativeController()
    hooks.afterOpen = () => {
      controller.abort()
    }
    const reading = getFontFallbacks(pathToFileURL(FIGTREE_PATH), {
      ...FILE_OPTIONS,
      signal: controller.signal,
    })
    await expect(getReason(reading)).resolves.toBe(controller.reason)
    expect(controller.listenerCount()).toBe(0)
  })

  it('rejects with its reason when aborted before the response', async () => {
    // A local server that never responds, which `fetch` reaches for FONT_URL, as the URL rules
    // take only `https:` URLs of a public host
    const server: Server = createServer(() => undefined)
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const { port } = server.address() as AddressInfo
    const nativeFetch = fetch
    vi.stubGlobal('fetch', async (_input: unknown, init?: RequestInit) =>
      nativeFetch(`http://127.0.0.1:${port}/f.ttf`, init),
    )
    try {
      const requested = once(server, 'request')
      const controller = createNativeController()
      const fetching = getFontFallbacks(FONT_URL, { ...FILE_OPTIONS, signal: controller.signal })
      await requested
      controller.abort()
      await expect(getReason(fetching)).resolves.toBe(controller.reason)
      expect(controller.listenerCount()).toBe(0)
    } finally {
      vi.unstubAllGlobals()
      server.closeAllConnections()
      server.close()
    }
  })
})

describe('a polyfill without a reason', () => {
  it('rejects with an AbortError, as a native abort without a reason does', async () => {
    const controller = createPolyfill(false)
    const looking = getFontFallbacks('Figtree', { signal: controller.signal })
    controller.abort()
    const error = await getReason(looking)
    expect(error).toBeInstanceOf(DOMException)
    expect(error).toMatchObject({ name: 'AbortError' })
    expect(controller.listenerCount()).toBe(0)
  })
})
