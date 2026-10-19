// V8 doesn't case-fold a one-character `\q{…}`, so with `i` the class matches `A` only without it
export const PATTERN = /[0-9b\q{a}]/iv
