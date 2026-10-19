export function run(list, callback) {
  for (const item of list) {
    callback(item)
    continue
  }
}
