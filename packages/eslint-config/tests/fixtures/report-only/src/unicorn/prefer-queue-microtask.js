// Node runs `nextTick` callbacks before promise jobs, and microtasks in order with them
export function schedule(callback) {
  process.nextTick(callback)
}
