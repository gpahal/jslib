// The error's class changes, and so does which `catch` handles it
export function check(value) {
  if (typeof value !== 'number') {
    throw new Error('Not a number')
  }
}
