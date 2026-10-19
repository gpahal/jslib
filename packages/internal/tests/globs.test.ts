import { expandBraces, scanBraces } from '@/globs'

const CONTEXT = { prefix: '@scope/config', subjects: ['`testFiles`'] }

test.each([
  ['src/{a,b}.ts', ['src/a.ts', 'src/b.ts']],
  ['src/*.ts', ['src/*.ts']],
  // A `!` that expansion puts first stays literal, as minimatch reads it, not a negation
  ['{!a,b}', [String.raw`\!a`, 'b']],
  ['!{a,b}', ['!a', '!b']],
  // An extglob that expansion puts first stays an extglob
  ['{!(a),b}/x.ts', ['@(!(a))/x.ts', 'b/x.ts']],
  ['{!(a,b}', [String.raw`\!(a`, 'b']],
  ['a{,}', ['a', 'a']],
  // Escapes stay, so the globs match what the glob does
  [String.raw`a\{b,c}`, [String.raw`a\{b,c}`]],
  [String.raw`{a,b}\{c,d}`, [String.raw`a\{c,d}`, String.raw`b\{c,d}`]],
  // As in bash, an escaped brace doesn't hide an unescaped comma
  [String.raw`x/{a,\{b,c\}}`, ['x/a', String.raw`x/\{b`, String.raw`x/c\}`]],
  [String.raw`{a\,b,c}`, [String.raw`a\,b`, 'c']],
  [String.raw`a\\{b,c}`, [String.raw`a\\b`, String.raw`a\\c`]],
  ['{a,b}\\', ['a\\', 'b\\']],
])('expands `%s` as minimatch does', (glob, expected) => {
  expect(expandBraces(glob, CONTEXT)).toEqual(expected)
})

const deep = `${'{a,'.repeat(11)}b${'}'.repeat(11)}`
test.each([
  ['{,}', 'glob `{,}` expands to an empty glob'],
  ['{1..1001}', 'glob `{1..1001}` expands to more than 1000 globs. List fewer alternatives'],
  ['a'.repeat(4097), `glob \`${'a'.repeat(20)}…${'a'.repeat(19)}\` has more than 4096 characters`],
  [deep, `glob \`${deep.slice(0, 20)}…${deep.slice(-19)}\` nests braces more than 10 deep`],
])('throws for the glob %#', (glob, description) => {
  expect(() => expandBraces(glob, CONTEXT)).toThrow(
    new TypeError(`@scope/config: \`testFiles\`: ${description}`),
  )
})

test('keeps every expansion at the limits', () => {
  expect(expandBraces(`${'{a,'.repeat(10)}b${'}'.repeat(10)}`, CONTEXT)).toHaveLength(11)
  // Over brace-expansion's default `maxLength` of 4,000,000 characters, which drops the rest
  const prefix = 'x'.repeat(4000)
  const globs = expandBraces(`${prefix}{1..1000}`, CONTEXT)
  expect(globs).toHaveLength(1000)
  expect(globs.at(-1)).toBe(`${prefix}1000`)
})

test('scans how deep braces nest and which stay unclosed, skipping escaped ones', () => {
  expect(scanBraces('src/{a,{b,c}}.ts')).toEqual({ depth: 2, unclosed: [] })
  expect(scanBraces(String.raw`\{a{b}`)).toEqual({ depth: 1, unclosed: [] })
  expect(scanBraces('a}{b{c}')).toEqual({ depth: 2, unclosed: [2] })
})
