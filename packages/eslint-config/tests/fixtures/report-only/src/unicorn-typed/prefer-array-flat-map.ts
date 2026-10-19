// `.flatMap()` copies each result before the next mapper call changes the shared array
export function flatMapped(): Array<number> {
  const shared: Array<number> = []
  return [1, 2]
    .map((value) => {
      shared.push(value)
      return shared
    })
    .flat()
}
