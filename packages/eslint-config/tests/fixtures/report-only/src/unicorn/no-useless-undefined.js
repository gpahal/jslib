// `callback(undefined)` passes one argument and `callback()` none, which `arguments.length` and a
// rest parameter tell apart
export function run(callback) {
  return callback(undefined)
}
