import { canMatchFile, canMatchOtherFile } from '@/internal/glob-match'

const SUBJECTS = ['`files`']

test.each([
  ['**/*.[cm]ts', ['cts', 'mts'], ['ts', 'json', 'yaml', 'md']],
  ['**/*.?(c|m)[jt]s?(x)', ['js', 'ts', 'cts', 'mts', 'jsx', 'tsx'], ['json', 'yaml', 'md']],
  ['**/!(test).ts', ['ts'], ['json', 'yaml', 'md']],
  ['**/*.{mts,cts}', ['mts', 'cts'], ['json', 'yaml', 'md']],
  ['src/file.ts', ['ts'], ['json', 'yaml', 'md']],
] as const)('checks the extension constraints of %s', (glob, matching, excluded) => {
  for (const extension of matching) {
    expect(canMatchFile(SUBJECTS, glob, [extension])).toBe(true)
  }
  for (const extension of excluded) {
    expect(canMatchFile(SUBJECTS, glob, [extension])).toBe(false)
  }
})

test.each([
  ['tests/????', 'ts'],
  ['**/*[.]json', 'json'],
  ['**/*.t*', 'json'],
  ['**/*.!(ts)', 'json'],
  ['**/*.foo[^a]json', 'json'],
  ['**/@(file.ts|file.json)', 'json'],
])(
  'retains a possible match for %s and extension %s when a pattern can consume a dot',
  (glob, extension) => {
    expect(canMatchFile(SUBJECTS, glob, [extension])).toBe(true)
  },
)

test.each([
  ['**/*.json', false],
  ['docs/README.md', false],
  ['**/*.{json,ts}', true],
  ['src/**', true],
  ['Dockerfile', true],
  ['**/*.[jy]son', true],
  ['**/*[.]json', true],
])('tells whether %s can match a file other than JSON, YAML or Markdown: %s', (glob, expected) => {
  expect(canMatchOtherFile(SUBJECTS, glob, ['json', 'yaml', 'md'])).toBe(expected)
})
