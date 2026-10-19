// `.flat()` drops the holes of a sparse group, and `concat` keeps them
export function concatFlat(groups: Array<Array<number>>): Array<number> {
  return groups.reduce((a, b) => a.concat(b), [])
}
