/**
 * The first index below `length` where `isPast` holds, or `length` where it never does, by binary
 * search. `isPast` must be false up to some index and true from there on
 */
export function findFirstIndex(length: number, isPast: (index: number) => boolean): number {
  let low = 0
  let high = length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (isPast(middle)) {
      high = middle
    } else {
      low = middle + 1
    }
  }
  return low
}
