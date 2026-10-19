export function build(isOn, extra) {
  return { a: 1, ...(isOn ? extra : {}) }
}
