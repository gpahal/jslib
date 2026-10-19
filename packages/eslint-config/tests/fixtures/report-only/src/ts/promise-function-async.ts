// As an `async` function, its `throw` would become a rejection, which a caller's `try` around the
// call doesn't catch
export function load(path: string): Promise<string> {
  if (path === '') {
    throw new Error('empty path')
  }
  return Promise.resolve(path)
}
