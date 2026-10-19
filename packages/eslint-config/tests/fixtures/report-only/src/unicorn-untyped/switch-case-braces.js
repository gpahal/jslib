// Braces end the scope of `n`, which the next case reads
export function total(kind) {
  let sum = 0
  switch (kind) {
    case 'a':
      let n = 1
    case 'b':
      sum += n ?? 2
      break
  }
  return sum
}
