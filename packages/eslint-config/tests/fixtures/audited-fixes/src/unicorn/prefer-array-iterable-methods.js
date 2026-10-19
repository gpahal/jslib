const list = [1, 2]

export function sum() {
  let total = 0
  for (const [, value] of list.entries()) {
    total += value
  }
  return total
}
