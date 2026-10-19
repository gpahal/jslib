// `indexOf` skips the holes of a sparse array, which `findIndex` visits as `undefined`, and reads
// `selected.id` once, even for an empty array, where `findIndex` reads it once per element
export function firstHole(items: ReadonlyArray<unknown>): number {
  return items.findIndex((item) => item === undefined)
}

export function position(items: ReadonlyArray<number>, selected: { readonly id: number }): number {
  return items.findIndex((item) => item === selected.id)
}
