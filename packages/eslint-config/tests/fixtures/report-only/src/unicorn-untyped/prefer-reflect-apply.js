// `Reflect.apply` calls `command` itself, which throws for an object with its own `apply` method
export function run(command, state) {
  return command.apply(null, [state])
}
