import { describe, it } from 'vitest'

import {
  checkIfPromiseIsSettled,
  createMutex,
  createTrackedPromise,
  sleep,
  sleepWithWakeup,
} from '@/promises'

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

describe('sleep', () => {
  it('should sleep for the given number of milliseconds', async () => {
    const start = Date.now()
    await sleep(100)
    const end = Date.now()
    expect(end - start).toBeGreaterThanOrEqual(100)
  })

  it('should sleep for the given number of milliseconds with jitter', async () => {
    const start = Date.now()
    await sleep(100, 0.1)
    const end = Date.now()
    expect(end - start).toBeGreaterThanOrEqual(85)
    expect(end - start).toBeLessThanOrEqual(125)
  })
})

describe('sleepWithWakeup', () => {
  it('should sleep for the given number of milliseconds', async () => {
    const start = Date.now()
    const [promise, _] = sleepWithWakeup(100)
    await promise
    const end = Date.now()
    expect(end - start).toBeGreaterThanOrEqual(100)
  })

  it('should sleep for the given number of milliseconds with jitter', async () => {
    const start = Date.now()
    const [promise, _] = sleepWithWakeup(100, 0.1)
    await promise
    const end = Date.now()
    expect(end - start).toBeGreaterThanOrEqual(85)
    expect(end - start).toBeLessThanOrEqual(125)
  })

  it('should wake up the promise and resolve', async () => {
    const start = Date.now()
    const [promise, wakeup] = sleepWithWakeup(10_000)
    wakeup()
    await promise
    const end = Date.now()
    expect(end - start).toBeLessThan(100)
  })

  it('should wake up the promise and reject', async () => {
    const start = Date.now()
    const [promise, wakeup] = sleepWithWakeup(10_000)
    wakeup({ reject: true })
    await expect(promise).rejects.toThrow(undefined)
    const end = Date.now()
    expect(end - start).toBeLessThan(100)
  })

  it('should wake up the promise and reject with a reason', async () => {
    const start = Date.now()
    const [promise, wakeup] = sleepWithWakeup(10_000)
    wakeup({ reject: true, rejectReason: new Error('Cancelled') })
    await expect(promise).rejects.toThrow('Cancelled')
    const end = Date.now()
    expect(end - start).toBeLessThan(100)
  })
})
