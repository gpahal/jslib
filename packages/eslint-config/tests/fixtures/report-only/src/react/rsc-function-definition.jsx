'use server'

// `async` makes `format` return a promise to its callers in this file
const format = (n) => `#${n}`

export const label = 'x' + format(1)

export { format }
