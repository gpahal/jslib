// `return cached || load()` returns `cached`, where the fix returns `undefined`
function load(): void {}
export function get(cached: string): string | void {
  if (cached) return cached || load()
  return 'default'
}
