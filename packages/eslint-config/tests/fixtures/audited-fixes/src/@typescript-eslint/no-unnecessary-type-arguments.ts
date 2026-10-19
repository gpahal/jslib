function f<T = string>(): T | undefined {
  return undefined
}
export const x = f<string>()
