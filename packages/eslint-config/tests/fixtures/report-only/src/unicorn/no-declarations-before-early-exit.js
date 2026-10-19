// Moving `limit` below the guard puts the call of `check` in its temporal dead zone
export function run(items) {
  const limit = 10
  if (!check()) {
    return 0
  }
  return limit

  function check() {
    return items.length < limit
  }
}
