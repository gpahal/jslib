import { canMatchFile, canMatchOtherFile } from '@/internal/glob-match'

const SUBJECTS = ['`files`']

test.each<[string, string, boolean]>([
  ['**/*.[cm]ts', 'cts', true],
  ['**/*.[cm]ts', 'mts', true],
  ['**/*.[cm]ts', 'ts', false],
  ['**/*.[cm]ts', 'json', false],
  ['**/*.[cm]ts', 'yaml', false],
  ['**/*.[cm]ts', 'md', false],
  ['**/*.?(c|m)[jt]s?(x)', 'js', true],
  ['**/*.?(c|m)[jt]s?(x)', 'ts', true],
  ['**/*.?(c|m)[jt]s?(x)', 'cts', true],
  ['**/*.?(c|m)[jt]s?(x)', 'mts', true],
  ['**/*.?(c|m)[jt]s?(x)', 'jsx', true],
  ['**/*.?(c|m)[jt]s?(x)', 'tsx', true],
  ['**/*.?(c|m)[jt]s?(x)', 'json', false],
  ['**/*.?(c|m)[jt]s?(x)', 'yaml', false],
  ['**/*.?(c|m)[jt]s?(x)', 'md', false],
  ['**/!(test).ts', 'ts', true],
  ['**/!(test).ts', 'json', false],
  ['**/!(test).ts', 'yaml', false],
  ['**/!(test).ts', 'md', false],
  ['**/*.{mts,cts}', 'mts', true],
  ['**/*.{mts,cts}', 'cts', true],
  ['**/*.{mts,cts}', 'json', false],
  ['**/*.{mts,cts}', 'yaml', false],
  ['**/*.{mts,cts}', 'md', false],
  ['src/file.ts', 'ts', true],
  ['src/file.ts', 'json', false],
  ['src/file.ts', 'yaml', false],
  ['src/file.ts', 'md', false],
  // A pattern that can consume a dot keeps a possible match
  ['tests/????', 'ts', true],
  ['**/*[.]json', 'json', true],
  ['**/*.t*', 'json', true],
  ['**/*.!(ts)', 'json', true],
  ['**/*.foo[^a]json', 'json', true],
  ['**/@(file.ts|file.json)', 'json', true],
])('tells whether %s can match a file with extension %s: %s', (glob, extension, expected) => {
  expect(canMatchFile(SUBJECTS, glob, [extension])).toBe(expected)
})

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
