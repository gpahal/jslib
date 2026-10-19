// A label inside a function may reuse an outer label's name, and one inside a block can't, so the
// block fails to parse
export function firstEmpty(rows) {
  let found
  row: for (const cells of rows) {
    ;(() => {
      row: for (const cell of cells) {
        if (cell === '') {
          found = cells
          break row
        }
      }
    })()
  }
  return found
}
