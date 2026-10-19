// Iterating a copy doesn't see what the loop adds, and iterating the array does
export function repeat(values) {
  for (const value of [...values]) {
    values.push(value)
  }
  return values
}
