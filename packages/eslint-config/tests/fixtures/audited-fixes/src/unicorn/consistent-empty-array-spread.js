export function build(isOn) {
  return [1, ...(isOn ? [2] : '')]
}
