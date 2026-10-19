function isString(value: unknown): value is string {
  return typeof value === 'string'
}

export function length(value: string): number {
  return isString(value) ? value.length : 0
}
