// `export { run as default }` exports the binding, which `setRun` updates, and
// `export default run` the value it has when the statement runs
/* eslint unicorn/no-named-default: "error" */
let run = () => 1

export { run as default }

export function setRun(next) {
  run = next
}
