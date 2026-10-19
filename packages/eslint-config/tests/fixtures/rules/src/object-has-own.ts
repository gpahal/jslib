export function hasName(value: object): boolean {
  return Object.prototype.hasOwnProperty.call(value, 'name')
}
