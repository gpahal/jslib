// `process.exit()` counts as an exit, but a test's stub of it returns, and then the code moved
// out of the `else` runs
export function main(isValid, run) {
  if (!isValid) {
    process.exit(1)
  } else {
    run()
  }
}
