// Other modules splice `PATTERN.source` into a pattern without `u`, where `\u{1f600}` is the text `u{1f600}`
export const PATTERN = /\ud83d\ude00/u
