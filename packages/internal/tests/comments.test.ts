import {
  getBlockCommentLines,
  hasMixedStarPrefixes,
  hasTextStar,
  hasUnusualLineTerminator,
  isStarredCommentLine,
} from '@/comments'

describe('getBlockCommentLines', () => {
  it.each([
    // Stars and shared indentation of a JSDoc-style block
    ['*\n * One\n *\n *   two\n ', ['One', '', '  two']],
    // A block without stars on every line keeps them
    [' One\n   * two\n   three', ['One', '* two', 'three']],
    // A star that starts the text of a line
    ['*\n *Important*: call init first.\n ', ['*Important*: call init first.']],
    ['\n*.css files go here\n', ['*.css files go here']],
    // A banner line
    ['\n * Buttons\n *-----\n ', ['Buttons', '-----']],
    // Indentation relative to the first line of a starred block with text on it
    ['* Usage:\n *     run()\n ', ['Usage:', '   run()']],
    // Indentation that aligns lines under the first line
    ['* One\n *  two\n *  @deprecated\n ', ['One', 'two', '@deprecated']],
    // A star directly before a tag, as TypeScript drops it
    ['*\n *@type {string}\n ', ['@type {string}']],
    // Every JavaScript line terminator
    ['*\u{2028} * One\u{2029} * Two\r * Three\r\n ', ['One', 'Two', 'Three']],
  ])('reads %j', (inner, lines) => {
    expect(getBlockCommentLines(inner)).toEqual(lines)
  })

  it('handles a comment of more lines than a call can take arguments', () => {
    expect(getBlockCommentLines(`*\n${' * a\n'.repeat(200_000)}`)).toHaveLength(200_000)
  })
})

// A line whose `*` is followed by text mixes with star prefixes, and its `*` is kept as text
test.each([
  ['*\n * One\n *bold* two\n ', true, true, ['One', '*bold* two']],
  ['*\n * One\n   two\n ', true, false, ['* One', '  two']],
  ['*\n * **bold**\n * *b*\n *\n ', false, false, ['**bold**', '*b*']],
  ['\n *bold*\n **bold**\n *b\n', false, true, ['*bold*', '**bold**', '*b']],
  // The `*` of `/**` isn't a prefix when text follows it
  ['*Note**: keep this\n   in sync ', false, true, ['Note**: keep this', 'in sync']],
  ['****\n * Title\n ****', false, true, ['***', 'Title', '***']],
])('reads the lines of %j', (inner, isMixed, isTextStar, lines) => {
  expect(hasMixedStarPrefixes(inner)).toBe(isMixed)
  expect(hasTextStar(inner)).toBe(isTextStar)
  expect(getBlockCommentLines(inner)).toEqual(lines)
})

test.each([
  [' a\r b', true],
  [' a\u{2028} b', true],
  [' a\r\n b\r', true],
  [' a\r\n b', false],
])('`hasUnusualLineTerminator(%j)` is %s', (inner, expected) => {
  expect(hasUnusualLineTerminator(inner)).toBe(expected)
})

test.each([
  [' * a', true],
  [' *-----', true],
  [' *@param x', true],
  [' *bold*', false],
  [' *.css', false],
  [' a * b', false],
])('`isStarredCommentLine(%j)` is %s', (line, expected) => {
  expect(isStarredCommentLine(line)).toBe(expected)
})
