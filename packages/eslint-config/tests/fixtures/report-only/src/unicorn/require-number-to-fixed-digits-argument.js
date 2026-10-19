// Decimal libraries' `toFixed()` doesn't round, and `toFixed(0)` does
export function format(amount) {
  return amount.toFixed()
}
