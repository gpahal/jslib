/**
 * Stands in for the Node types, which this package doesn't install
 */
declare module 'node:fs/promises' {
  export function readFile(path: string): Promise<string>
}
