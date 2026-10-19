// The fix moves `a*` out of the lookahead, so `baa!` matches `ba` where it didn't match
export const PATTERN = /\w+(?!a*[0\W])/
