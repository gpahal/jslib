export function load() {
  return fetch('/api', { method: 'GET' })
}
