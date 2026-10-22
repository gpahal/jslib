import type * as envsModule from '@/envs'
import { hasDocument, isWebWorker } from '@/envs'

/**
 * A fresh copy of the module, which reads the globals when it loads
 */
async function loadEnvs(): Promise<typeof envsModule> {
  vi.resetModules()
  return import('@/envs')
}

/**
 * A stand-in for a worker's `WorkerGlobalScope`, whose `instanceof` runs `hasInstance`
 */
function createWorkerGlobalScope(hasInstance: (value: unknown) => boolean): () => void {
  return Object.defineProperty(() => undefined, Symbol.hasInstance, { value: hasInstance })
}

describe('envs', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([
    {
      name: 'a process.platform of "win32"',
      stub: { ...process, platform: 'win32' },
      expected: true,
    },
    { name: 'no process, as in a browser', stub: undefined, expected: false },
  ])('sets isWindows to $expected for $name as the module loads', async ({ stub, expected }) => {
    vi.stubGlobal('process', stub)
    const envs = await loadEnvs()
    expect(envs.isWindows).toBe(expected)
  })

  it('has no document and is no Web Worker under Node.js', () => {
    expect(hasDocument).toBe(false)
    expect(isWebWorker).toBe(false)
  })

  it('has a document when a global document exists as the module loads', async () => {
    vi.stubGlobal('document', {})
    const envs = await loadEnvs()
    expect(envs.hasDocument).toBe(true)
    expect(envs.isWebWorker).toBe(false)
  })

  it('is a Web Worker when the global object is a WorkerGlobalScope as the module loads', async () => {
    vi.stubGlobal(
      'WorkerGlobalScope',
      createWorkerGlobalScope((value) => value === globalThis),
    )
    const envs = await loadEnvs()
    expect(envs.isWebWorker).toBe(true)
    expect(envs.hasDocument).toBe(false)
  })

  it('is no Web Worker when WorkerGlobalScope is not a class, or its instanceof check throws', async () => {
    vi.stubGlobal('WorkerGlobalScope', {})
    expect((await loadEnvs()).isWebWorker).toBe(false)
    vi.stubGlobal(
      'WorkerGlobalScope',
      createWorkerGlobalScope(() => {
        throw new Error('broken')
      }),
    )
    expect((await loadEnvs()).isWebWorker).toBe(false)
  })
})
