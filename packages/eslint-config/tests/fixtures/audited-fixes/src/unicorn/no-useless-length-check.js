export function allOn(list) {
  return list.length === 0 || list.every((item) => item.isOn)
}
