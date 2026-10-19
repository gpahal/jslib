const log = (value) => value

export const call = (flag, a, b) => (flag ? log(a) : log(b))
