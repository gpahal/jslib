class Counter {
  count = 0

  increment(): void {
    this.count += 1
  }
}

export const counter = new Counter()
export const increment = counter.increment
