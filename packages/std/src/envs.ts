export const isWindows =
  typeof globalThis !== 'undefined' &&
  'process' in globalThis &&
  typeof (globalThis as { process?: { platform?: string } }).process === 'object' &&
  (globalThis as { process?: { platform?: string } }).process?.platform === 'win32'
export const isBrowser = typeof document !== 'undefined' && !!document
