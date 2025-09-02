import { describe, it } from 'vitest'

import {
  combineCancelSignals,
  createCancellablePromise,
  createCancelSignal,
  createTimeoutCancelSignal,
} from '@/cancel'
import { sleep } from '@/promises'

describe('createCancelSignal', () => {
  it('should create a cancel signal', () => {
    const [cancelSignal, cancel] = createCancelSignal()
    let executionCount = 0
    cancelSignal.onCancelled(() => {
      executionCount++
    })
    cancel()
    expect(executionCount).toBe(1)
  })

  it('should create a cancel signal with an abort signal', () => {
    const abortController = new AbortController()
    const [cancelSignal, _] = createCancelSignal({ abortSignal: abortController.signal })
    let executionCount = 0
    cancelSignal.onCancelled(() => {
      executionCount++
    })
    abortController.abort()
    expect(executionCount).toBe(1)
  })

  it('should create a cancel signal with a timeout', async () => {
    const [cancelSignal, _] = createTimeoutCancelSignal(10)
    let executionCount = 0
    cancelSignal.onCancelled(() => {
      executionCount++
    })
    expect(executionCount).toBe(0)
    await sleep(100)
    expect(executionCount).toBe(1)
  })
})

describe('combineCancelSignals', () => {
  it('should combine cancel signals', () => {
    const [cancelSignal1, cancel1] = createCancelSignal()
    const [cancelSignal2, cancel2] = createCancelSignal()
    const combinedCancelSignal = combineCancelSignals([cancelSignal1, cancelSignal2])
    let executionCount = 0
    combinedCancelSignal.onCancelled(() => {
      executionCount++
    })

    expect(combinedCancelSignal.isCancelled()).toBe(false)
    expect(executionCount).toBe(0)
    cancel1()
    expect(combinedCancelSignal.isCancelled()).toBe(true)
    expect(executionCount).toBe(1)
    cancel2()
    expect(combinedCancelSignal.isCancelled()).toBe(true)
    expect(executionCount).toBe(1)
  })
})

describe('createCancellablePromise', () => {
  it('should create a cancellable promise that completes', async () => {
    const [cancelSignal, _] = createCancelSignal()
    const cancellablePromise = createCancellablePromise(sleep(10), cancelSignal)
    expect(await cancellablePromise).toBe(undefined)
  })

  it('should create a cancellable promise that is cancelled', async () => {
    const [cancelSignal, cancel] = createCancelSignal()
    const cancellablePromise = createCancellablePromise(sleep(500), cancelSignal)
    cancel()
    await expect(cancellablePromise).rejects.toThrow('Cancelled')
  })
})
