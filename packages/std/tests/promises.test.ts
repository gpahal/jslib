import { describe, it } from 'vitest'

import { checkIfPromiseIsSettled, createMutex, createTrackedPromise, sleep } from '@/promises'

describe('createMutex', () => {
  it('should create a mutex', async () => {
    const mutex = createMutex()
    const startTimes = new Map<number, number>()
    const endTimes = new Map<number, number>()

    const runSomethingSequentially = async (index: number) => {
      await mutex.acquire()
      startTimes.set(index, Date.now())
      try {
        await sleep(100)
        endTimes.set(index, Date.now())
      } finally {
        mutex.release()
      }
    }

    const promises = Array.from({ length: 10 }, (_, i) => runSomethingSequentially(i))
    await Promise.all(promises)

    for (let i = 0; i < 10; i++) {
      const startTime = startTimes.get(i)!
      const endTime = endTimes.get(i)!
      expect(endTime - startTime).toBeGreaterThanOrEqual(95)
      if (i > 0) {
        const prevEndTime = endTimes.get(i - 1)!
        expect(startTime).toBeGreaterThanOrEqual(prevEndTime)
      }
    }
  })
})

describe('createTrackedPromise', () => {
  it('should create a tracked promise', async () => {
    const promise = createTrackedPromise(new Promise((resolve) => setTimeout(resolve, 1000)))
    expect(promise.getStatus()).toBe('pending')
    expect(promise.checkIfSettled()).toBe(false)
    await promise
    expect(promise.getStatus()).toBe('resolved')
    expect(promise.checkIfSettled()).toBe(true)
  })
})

describe('checkIfPromiseIsSettled', () => {
  it('should return true if the promise is settled', async () => {
    expect(await checkIfPromiseIsSettled(Promise.resolve())).toBe(true)
    expect(await checkIfPromiseIsSettled(Promise.reject(new Error('test')))).toBe(true)
  })

  it('should return false if the promise is not settled', async () => {
    expect(await checkIfPromiseIsSettled(sleep(100))).toBe(false)
  })
})
