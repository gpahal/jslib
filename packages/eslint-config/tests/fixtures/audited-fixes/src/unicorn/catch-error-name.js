export function run(callback) {
  try {
    return callback()
  } catch (e) {
    return e
  }
}
