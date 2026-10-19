// `x(?:a||b)?` matches `xb` where `x(?:a||b|)` matches `x`
export const PATTERN = /x(?:a||b|)/
