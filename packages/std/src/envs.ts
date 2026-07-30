export const isWindows =
  typeof globalThis !== 'undefined' &&
  'process' in globalThis &&
  (globalThis as { process?: { platform?: string } }).process?.platform === 'win32'
export const isBrowser = typeof document !== 'undefined' && !!document
