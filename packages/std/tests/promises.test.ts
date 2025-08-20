import { describe, it } from 'vitest'

import { createMutex, sleep } from '@/promises'

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
