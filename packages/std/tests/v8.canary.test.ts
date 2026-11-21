import process from 'node:process'

const NODE_MAJOR = Number(process.versions.node.split('.', 1)[0])

// Node 24, which CI runs, doesn't have the bug, so the canary runs only from Node 26
test.runIf(NODE_MAJOR >= 26)(
  'V8 still fails to match a letter outside the BMP with a character class just before `$`',
  () => {
    expect(
      /[\p{L}\p{N}_]$/u.test('a𠮷'),
      'V8 matches it now: end ENDS_WITH_WORD_CHAR_REGEX in src/errors.ts with `$`',
    ).toBe(false)
  },
)
