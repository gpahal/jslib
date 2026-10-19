export function withNames(list) {
  return list.filter((item) => Boolean(item.name))
}
