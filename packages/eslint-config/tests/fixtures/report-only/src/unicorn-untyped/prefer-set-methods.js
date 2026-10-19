// `Set#union` is ES2025, which an older runtime lacks
export function union(a, b) {
  const first = new Set(a)
  const second = new Set(b)
  return new Set([...first, ...second])
}
