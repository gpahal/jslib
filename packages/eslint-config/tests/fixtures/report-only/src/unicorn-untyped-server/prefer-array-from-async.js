// `Array.fromAsync` is newer than ES2025, which an older runtime lacks
export async function collect(source) {
  const items = []
  for await (const item of source) {
    items.push(item)
  }
  return items
}
