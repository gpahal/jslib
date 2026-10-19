export function firstLength(items: Array<string>, value: unknown): number {
  return items[0]!.length + (value as { a: number }).a
}
