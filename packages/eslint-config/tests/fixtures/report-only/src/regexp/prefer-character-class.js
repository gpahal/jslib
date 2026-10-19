// The source is spliced into another pattern, where `a|b|c+` and `[abc]+` differ
const SEPARATOR = /a|b|c/

export const PATTERN = new RegExp(`${SEPARATOR.source}+`)
