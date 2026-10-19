// `Object.values` snapshots the values, and `object[key]` reads each one when the loop gets to it
export function visitAll(object, visit) {
  for (const key of Object.keys(object)) {
    visit(object[key])
  }
}
