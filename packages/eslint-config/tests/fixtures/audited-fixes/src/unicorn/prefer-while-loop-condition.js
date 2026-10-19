export function run(items) {
  while (true) {
    if (items.length === 0) {
      break
    }
    console.log(items.pop())
  }
}
