/**
 * A FIFO queue. Contract: values of any kind, from the developer's own code. An entry from another
 * queue throws, since it's an easy mistake to make
 */

import { stdMessage } from '@/internal/message'

type QueueNode<T> = {
  readonly value: T
  prev?: QueueNode<T> | undefined
  next?: QueueNode<T> | undefined
  isRemoved?: boolean | undefined
}

declare const entryBrand: unique symbol

/**
 * A handle to a value in a {@link Queue}, for {@link Queue.remove}. Only a queue's `enqueue`
 * creates one
 */
export type QueueEntry<T> = { readonly value: T; readonly [entryBrand]: true }

/**
 * A FIFO queue backed by a doubly linked list, so dequeuing and removing any value are O(1)
 */
export type Queue<T> = {
  /**
   * The number of values in the queue
   */
  readonly size: number
  /**
   * Adds a value and returns a handle to remove it with
   */
  enqueue: (value: T) => QueueEntry<T>
  /**
   * Removes and returns the oldest value, or `undefined` if the queue is empty
   */
  dequeue: () => T | undefined
  /**
   * Returns the oldest value without removing it, or `undefined` if the queue is empty
   */
  peek: () => T | undefined
  /**
   * Removes a value from anywhere in the queue. Does nothing if it was already dequeued or removed.
   *
   * @throws TypeError if `entry` didn't come from this queue's `enqueue`
   */
  remove: (entry: QueueEntry<T>) => void
  /**
   * Removes every value. Removing an earlier entry afterwards does nothing
   */
  clear: () => void
  /**
   * Iterates a copy of the values, oldest first, without removing them
   */
  [Symbol.iterator]: () => IterableIterator<T, undefined>
}

/**
 * The node of `entry` when it's a handle of the queue `owner`. Set by {@link Handle}, which alone
 * can read its private fields. A module binding, unlike a method, can't be replaced from outside
 */
let getNode: <T>(entry: QueueEntry<T>, owner: object) => QueueNode<T> | undefined

/**
 * The object behind a {@link QueueEntry}. Private fields hold its node and its queue, so a handle
 * from another queue is told apart without a lookup table
 */
class Handle<T> {
  readonly value: T
  declare readonly [entryBrand]: true
  readonly #node: QueueNode<T>
  readonly #owner: object

  static {
    getNode = <V>(entry: QueueEntry<V>, owner: object): QueueNode<V> | undefined =>
      Handle.#isHandle(entry) && entry.#owner === owner ? entry.#node : undefined
  }

  constructor(node: QueueNode<T>, owner: object) {
    this.value = node.value
    this.#node = node
    this.#owner = owner
    // So writing `value` throws in strict mode, as its type says. Private fields stay writable
    Object.freeze(this)
  }

  /**
   * Whether `entry` was made by any queue's `enqueue`
   */
  static #isHandle<V>(entry: QueueEntry<V>): entry is Handle<V> {
    const value: unknown = entry
    return typeof value === 'object' && value !== null && #owner in value
  }
}

/**
 * Create a FIFO queue
 *
 * @example
 * ```ts
 * import { createQueue } from '@gpahal/std/queue'
 *
 * const queue = createQueue<string>()
 * queue.enqueue('a')
 * const entry = queue.enqueue('b')
 * queue.enqueue('c')
 * queue.remove(entry)
 * queue.dequeue() // 'a'
 * queue.dequeue() // 'c'
 * queue.size // 0
 * ```
 */
export function createQueue<T>(): Queue<T> {
  let head: QueueNode<T> | undefined
  let tail: QueueNode<T> | undefined
  let size = 0
  const owner = {}

  const unlink = (node: QueueNode<T>) => {
    node.isRemoved = true
    size--
    if (node.prev) {
      node.prev.next = node.next
    } else {
      head = node.next
    }
    if (node.next) {
      node.next.prev = node.prev
    } else {
      tail = node.prev
    }
    node.prev = undefined
    node.next = undefined
  }

  return {
    get size() {
      return size
    },
    enqueue: (value) => {
      const node: QueueNode<T> = { value, prev: tail }
      if (tail) {
        tail.next = node
      } else {
        head = node
      }
      tail = node
      size++
      return new Handle(node, owner)
    },
    dequeue: () => {
      const node = head
      if (!node) {
        return undefined
      }

      unlink(node)
      return node.value
    },
    peek: () => head?.value,
    remove: (entry) => {
      const node = getNode(entry, owner)
      if (!node) {
        throw new TypeError(
          stdMessage(
            ['`queue.remove`', '`entry`'],
            "the entry didn't come from this queue's `enqueue`",
          ),
        )
      }
      if (node.isRemoved !== true) {
        unlink(node)
      }
    },
    clear: () => {
      // Unlinks each node, so a kept entry doesn't keep the other nodes alive
      let node = head
      while (node) {
        const next: QueueNode<T> | undefined = node.next
        node.isRemoved = true
        node.prev = undefined
        node.next = undefined
        node = next
      }
      head = undefined
      tail = undefined
      size = 0
    },
    [Symbol.iterator]: () => {
      const values: Array<T> = []
      for (let node = head; node; node = node.next) {
        values.push(node.value)
      }
      return values[Symbol.iterator]()
    },
  }
}
