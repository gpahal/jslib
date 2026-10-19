// Other modules splice `PATTERN.source` into a pattern without `i`, where `[a-z0-9_]` isn't `\w`
export const PATTERN = /[a-z0-9_]/i
