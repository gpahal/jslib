export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export type NonEmptyArray<T> = [T, ...T[]];

export function pushToArray<T>(array?: T[], ...items: T[]): T[] {
  if (array) {
    array.push(...items);
    return array;
  } else {
    return [...items];
  }
}

export function dedupeArray<T>(array?: T[]): T[] {
  return [...new Set(array)];
}

export function flattenArray<T>(array: T[][]): T[] {
  return array.reduce((a, b) => a.concat(b), []);
}
