export function hasEmpty(list) {
  return !list.every((item) => item.length > 0)
}
