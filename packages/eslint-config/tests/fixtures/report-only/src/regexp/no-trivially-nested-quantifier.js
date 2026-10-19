// The outer repeat resets the capture, so on `a` group 1 is unset, where `(a){0,2}` captures `a`
export const PATTERN = /(?:(a)?){2}/
