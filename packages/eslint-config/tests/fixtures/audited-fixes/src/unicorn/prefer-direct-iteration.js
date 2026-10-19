export function log(items) {
  const list = [...items]
  for (const item of list.values()) {
    console.log(item)
  }
}
