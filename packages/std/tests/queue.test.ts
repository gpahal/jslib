import { createQueue } from '@/queue'

describe('createQueue', () => {
  it('dequeues values in the order they were enqueued', () => {
    const queue = createQueue<number>()
    expect(queue.dequeue()).toBeUndefined()
    queue.enqueue(1)
    queue.enqueue(2)
    expect(queue.peek()).toBe(1)
    expect(queue.dequeue()).toBe(1)
    queue.enqueue(3)
    expect([queue.dequeue(), queue.dequeue(), queue.dequeue()]).toEqual([2, 3, undefined])
  })

  it('removes a value from the head, the middle or the tail, keeping peek and size right', () => {
    const queue = createQueue<string | undefined>()
    const entries = ['a', 'b', 'c', 'd'].map((value) => queue.enqueue(value))
    queue.remove(entries[1]!)
    queue.remove(entries[1]!)
    queue.remove(entries[0]!)
    queue.remove(entries[3]!)
    expect([queue.peek(), queue.size]).toEqual(['c', 1])
    queue.enqueue(undefined)
    expect([...queue]).toEqual(['c', undefined])
    queue.remove(entries[2]!)
    expect([queue.size, queue.dequeue(), queue.size]).toEqual([1, undefined, 0])
    queue.enqueue('e')
    expect([queue.peek(), queue.size]).toEqual(['e', 1])
  })

  it('iterates the values it held when iteration started, without dequeuing', () => {
    const queue = createQueue<string>()
    queue.enqueue('a')
    const b = queue.enqueue('b')
    const seen: Array<string> = []
    for (const value of queue) {
      seen.push(value)
      if (value !== 'a') {
        continue
      }

      queue.remove(b)
      queue.enqueue('c')
    }
    expect(seen).toEqual(['a', 'b'])
    expect([...queue]).toEqual(['a', 'c'])
    expect(queue.size).toBe(2)
  })

  it('clears every value, after which old entries count as removed', () => {
    const queue = createQueue<string>()
    queue.enqueue('a')
    const b = queue.enqueue('b')
    queue.clear()
    expect([queue.size, queue.peek(), [...queue]]).toEqual([0, undefined, []])
    queue.enqueue('c')
    queue.remove(b)
    expect([...queue]).toEqual(['c'])
  })

  it("throws for another queue's or a forged entry, and leaves the queues unchanged", () => {
    const a = createQueue<string>()
    const b = createQueue<string>()
    const a1 = a.enqueue('a1')
    b.enqueue('b1')
    const error = new TypeError(
      "@gpahal/std: `queue.remove`: `entry`: the entry didn't come from this queue's `enqueue`",
    )
    expect(() => {
      b.remove(a1)
    }).toThrow(error)
    // Made from an entry's prototype, it has none of an entry's private state
    const forged = Object.assign(Object.create(Object.getPrototypeOf(a1) as object) as object, a1)
    expect(() => {
      b.remove(forged)
    }).toThrow(error)
    expect([a.size, b.size, a.peek(), b.peek()]).toEqual([1, 1, 'a1', 'b1'])
  })
})
