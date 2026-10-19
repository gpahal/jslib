export function names(list) {
  return list.filter((item) => item.isOn).flatMap((item) => [item.name])
}
