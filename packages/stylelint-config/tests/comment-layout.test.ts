import process from 'node:process'

import stylelint from 'stylelint'

import { defineConfig } from '@/index'

import { fix, lintRules } from './helpers'

const baseConfig = await defineConfig({ root: process.cwd() })

/**
 * The rule alone, so other rules' reports don't mix in
 */
const config = { plugins: baseConfig.plugins ?? [], rules: { '@gpahal/comment-layout': true } }

/**
 * Joins lines, so each case reads with its layout visible
 */
function code(...lines: Array<string>): string {
  return lines.join('\n')
}

test.each([
  code('/* One line. */', 'a {}'),
  code('/*', ' * Starred.', ' *', ' * Second paragraph.', ' */', 'a {}'),
  // Legal comments and directives
  code('/*! Legal', '   text. */', 'a {}'),
  code('/* stylelint-disable', '   color-named */', 'a {}'),
  // Code before or after it on its lines
  code('a { color: red; /* One', '  two. */ }'),
  // Banners, whose first or last line is a rule of one repeated character
  code('/*****', ' * Section', ' *****/', 'a {}'),
  code('/* ===', '   Section', '   === */', 'a {}'),
  // Commented-out CSS, which the fix would leave needing cleanup to uncomment
  code('/*', '.b {', '  color: red;', '}', '*/', 'a {}'),
  code('/*', ' * .b {', ' *   color: red;', ' * }', ' */', 'a {}'),
  code('a {', '  /* color: red;', '     margin: 0; */', '  padding: 0;', '}'),
])('accepts %s', async (css) => {
  expect(await lintRules(css, config)).toEqual([])
})

test.each([
  [code('/*', 'Bare.', '*/', 'a {}'), code('/*', ' * Bare.', ' */', 'a {}')],
  // A banner's rule line keeps its text, without a second `*`
  [
    code('/*', ' * Buttons', ' *-----', ' */', 'a {}'),
    code('/*', ' * Buttons', ' * -----', ' */', 'a {}'),
  ],
  [
    code('a {', '  /* One', '     two. */', '  color: red;', '}'),
    code('a {', '  /*', '   * One', '   * two.', '   */', '  color: red;', '}'),
  ],
  [
    code('@media (width >= 40rem) {', '  a {', '    /* One', '', '       two. */', '  }', '}'),
    code(
      '@media (width >= 40rem) {',
      '  a {',
      '    /*',
      '     * One',
      '     *',
      '     * two.',
      '     */',
      '  }',
      '}',
    ),
  ],
  // Not banners: a rule line in the middle, a short rule, or text on the rule line
  [
    code('/* Top', '   ====', '   Bottom */', 'a {}'),
    code('/*', ' * Top', ' * ====', ' * Bottom', ' */', 'a {}'),
  ],
  // Prose that parses as CSS without a block or a `;`
  [
    code('/* Note: this is wrong', '   for now. */', 'a {}'),
    code('/*', ' * Note: this is wrong', ' * for now.', ' */', 'a {}'),
  ],
])('fixes %s', async (css, expected) => {
  expect(await lintRules(css, config)).toEqual(['@gpahal/comment-layout'])
  expect(await fix(css, config)).toBe(expected)
  expect(await lintRules(expected, config)).toEqual([])
})

test.each([
  ['whose lines mix star prefixes', code('/*', ' * a', ' b */', 'a {}')],
  ['whose lines mix star prefixes', code('/*', ' * One', ' *bold* two', ' */', 'a {}')],
  ['with a line break other than LF or CRLF', code('a {', '  /* One\r     two.', '  */', '}')],
  // A `*` with text right after it is text, such as Markdown emphasis or a glob, not a prefix
  ['with a line that starts with a starred word', code('/*', ' *a', ' */', 'a {}')],
  // The `*` of `/**` with text right after it may be emphasis, as the bold of `**Note**`
  [
    'with a line that starts with a starred word',
    code('/**Note**: keep this', '   in sync */', 'a {}'),
  ],
  [
    'whose stars after a first line of text could be prefixes or bullets',
    code('/* Notes:', ' * a', ' * b', ' */', 'a {}'),
  ],
])('reports a comment %s without a fix: %j', async (_reason, css) => {
  expect(await lintRules(css, config)).toEqual(['@gpahal/comment-layout'])
  expect(await fix(css, config)).toBe(css)
})

test('reports a text star beside star prefixes as one, not as mixed prefixes', async () => {
  const css = code('/*', ' * Globs:', ' *.css', ' */', 'a {}')
  const { results } = await stylelint.lint({ code: css, config })
  expect(results.flatMap((result) => result.warnings.map((warning) => warning.text))).toEqual([
    expect.stringContaining('a line starts with a `*` that is text'),
  ])
  expect(await fix(css, config)).toBe(css)
})

test('leaves directives under a custom `configurationComment` alone', async () => {
  const customConfig = {
    ...config,
    configurationComment: 'mylint',
    rules: { ...config.rules, 'color-named': 'never' as const },
  }
  const css = code(
    'a {',
    '  /* mylint-disable-next-line',
    '     color-named */',
    '  color: red;',
    '}',
  )
  expect(await fix(css, customConfig)).toBe(css)
  expect(await lintRules(css, customConfig)).toEqual([])
})

test.each([
  ['a.html', code('<style>', '  /* One', '     two. */', '  a {}', '</style>', '')],
  ['a.md', code('# Title', '', '```css', '/* One', '   two. */', 'a {}', '```', '')],
])(
  'reports the first comment of an embedded stylesheet in %s with LF and CRLF alike',
  async (file, source) => {
    const embeddedConfig = {
      ...config,
      overrides: [
        { files: ['**/*.html'], customSyntax: 'postcss-html' },
        { files: ['**/*.md'], customSyntax: 'postcss-markdown' },
      ],
    }
    const crlf = source.replaceAll('\n', '\r\n')
    expect(await lintRules(source, embeddedConfig, file)).toEqual(['@gpahal/comment-layout'])
    expect(await lintRules(crlf, embeddedConfig, file)).toEqual(['@gpahal/comment-layout'])
    expect(await fix(crlf, embeddedConfig, file)).toBe(
      (await fix(source, embeddedConfig, file)).replaceAll('\n', '\r\n'),
    )
  },
)
