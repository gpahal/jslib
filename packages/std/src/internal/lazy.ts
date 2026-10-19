/**
 * Values built on first use, so loading a module doesn't build them and bundlers can drop them
 */

/**
 * A function that calls `create` on its first call and gives that result on every call. It's marked
 * free of side effects, so a bundler drops an unused `lazy(...)` at a module's top level
 */
/* @__NO_SIDE_EFFECTS__ */
export function lazy<T>(create: () => T): () => T {
  let cell: { value: T } | undefined
  return () => {
    cell ??= { value: create() }
    return cell.value
  }
}
