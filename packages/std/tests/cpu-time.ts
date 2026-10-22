/**
 * The least CPU time, in milliseconds, this thread spent in each of `fns` over `runs` interleaved
 * rounds. Unlike wall-clock time, it leaves out time other processes take. A copy of `minCpuMs`
 * from `@gpahal/internal/node/testing`, which std can't depend on, since that package depends on std
 */
export function minCpuMs(fns: ReadonlyArray<() => unknown>, runs = 3): Array<number> {
  const mins = fns.map(() => Infinity)
  for (let run = 0; run < runs; run++) {
    for (const [index, fn] of fns.entries()) {
      const start = process.threadCpuUsage()
      fn()
      const { user, system } = process.threadCpuUsage(start)
      mins[index] = Math.min(mins[index] ?? Infinity, (user + system) / 1000)
    }
  }
  return mins
}
