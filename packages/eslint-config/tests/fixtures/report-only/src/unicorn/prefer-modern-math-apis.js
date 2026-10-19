// For 1000, this gives 3, and `Math.floor(Math.log10(n)) + 1` 4
export function digits(n) {
  return Math.floor(Math.log(n) / Math.LN10) + 1
}
