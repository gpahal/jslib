export function isDate(value) {
  return /^(\d{4})-\d{2}$/u.test(value)
}
