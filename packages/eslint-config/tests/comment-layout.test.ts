import path from 'node:path'

import { parseForESLint } from '@typescript-eslint/parser'
import { Linter, RuleTester } from 'eslint'
import eslintPluginAstro from 'eslint-plugin-astro'
import * as prettier from 'prettier'
import { parser as tsEslintParser } from 'typescript-eslint'

import { countWork } from '@gpahal/internal/node/testing'
import { defineConfig as definePrettierConfig } from '@gpahal/prettier-config'

import { GPAHAL_PLUGIN } from '@/internal/plugin'

import { CORE_AREAS_OFF, createESLint, FIXTURES_DIR } from './helpers'

const astroParser = eslintPluginAstro.configs['flat/base'].find(
  (config: Linter.Config) => config.languageOptions?.['parser'] !== undefined,
)?.languageOptions?.['parser']

const astroOptions = {
  filename: 'x.astro',
  languageOptions: { parser: astroParser, parserOptions: { parser: tsEslintParser } },
}

const SECURITY_DIRECTIVES = [
  'deepcode ignore HardcodedNonCryptoSecret: test fixture',
  'pragma: allowlist nextline secret',
  'codeql[js/hardcoded-credentials]',
]

const tester = new RuleTester({
  languageOptions: {
    parser: tsEslintParser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
})

/**
 * Joins lines, so each case reads with its layout visible
 */
function code(...lines: Array<string>): string {
  return lines.join('\n')
}

type Extra = Partial<RuleTester.InvalidTestCase>

/**
 * A case reported with `messageId` and the one suggestion `suggestionId`, which gives `output`
 */
function suggests(
  source: string,
  messageId: string,
  suggestionId: string,
  output: string,
  extra: Extra = {},
): RuleTester.InvalidTestCase {
  return {
    code: source,
    output: null,
    ...extra,
    errors: [{ messageId, suggestions: [{ messageId: suggestionId, output }] }],
  }
}

function toDoc(source: string, output: string, extra: Extra = {}): RuleTester.InvalidTestCase {
  return suggests(source, 'doc', 'toDoc', output, extra)
}

function fixes(
  source: string,
  output: string | null,
  messageId: string,
  extra: Extra = {},
): RuleTester.InvalidTestCase {
  return { code: source, output, ...extra, errors: [{ messageId }] }
}

/**
 * Assignments that declare a property or export in a JavaScript file, where TypeScript reads the
 * JSDoc above them. After a statement, so no block is the module header
 */
const DECLARING_ASSIGNMENTS = [
  code('class C {', 'constructor() {', '/**', ' * The x.', ' */', 'this.x = 1', '}', '}'),
  code('const y = 0', '/**', ' * The x.', ' */', 'exports.x = 1'),
  code('const y = 0', '/**', ' * The API.', ' */', 'module.exports = {}'),
  code('function Foo() {', '  /**', '   * The size.', '   */', '  this.size = 0', '}'),
]

/**
 * `source` with its one-line starred doc block as a `//` comment
 */
function withLineComment(source: string): string {
  return source.replace(/\/\*\*\n\s* \* (.*)\n\s* \*\//, '// $1')
}

tester.run('comment-layout', GPAHAL_PLUGIN.rules['comment-layout'], {
  valid: [
    // A leading `@typedef` block declares a type, so the doc block below it documents the function
    {
      code: code(
        'function f() {',
        '/** @typedef {string} A */',
        '/**',
        ' * Doc.',
        ' */',
        'function g() {}',
        '}',
      ),
      filename: 'x.js',
    },
    ...SECURITY_DIRECTIVES.map((directive) => code(`// ${directive}`, 'export const KEY = "sk_1"')),
    // Doc blocks on declarations, members and constituents, and before a parameter on its line
    code('/**', ' * Doc.', ' */', 'export const a = 1'),
    code('type T = {', '  /**', '   * Member.', '   */', '  a: string', '}'),
    code('type U =', "  | 'a'", '  /**', '   * Constituent.', '   */', "  | 'b'"),
    code('class C {', '  constructor(a: number, /** the size */ private size: number) {}', '}'),
    // Nested text keeps its extra indentation
    code('/**', ' * A list:', ' * - one', ' *   continued', ' */', 'const a = 1'),
    // Object-literal members, nested function declarations and parameters take either
    code('const o = {', '  /**', '   * Member.', '   */', '  a: 1,', '}'),
    code('const o = {', '  // Member.', '  a: 1,', '}'),
    code('function f(', '  // The x.', '  x: string,', ') {}'),
    // Blocks with JSDoc tags stay wherever they are, however far the tag is indented
    code('f(/** @deprecated */ 1)'),
    code('function f() {', '  /** Note', '   *     @deprecated', '   */', '  let a', '}'),
    { code: code('foo(/**', ' *@type {string}', ' */ (bar))'), filename: 'x.js' },
    // `//` everywhere else, and a blank line detaches a note from the declarations below it
    code('function f() {', '  // Statement.', '  return 1', '}'),
    code('// Import.', "import a from 'a'"),
    code('// A group.', '', 'const a = 1'),
    // Directives stay, and do not detach a doc block
    code('/**', ' * Doc.', ' */', '// eslint-disable-next-line no-console', 'const a = 1'),
    // Other tools' directives, pragmas, legal comments, bundler annotations, task markers,
    // banners and commented-out code
    ...[
      '/// <reference types="vite/client" />',
      '// biome-ignore lint/style: reason',
      '// @jsxImportSource preact',
      '// # sourceMappingURL=a.js.map',
      '// cspell:words foo bar',
      '// noinspection JSUnusedGlobalSymbols',
      '/** #__NO_SIDE_EFFECTS__ */',
      '/**! Foo v1.0 | MIT */',
      '/* Copyright 2026 */',
      '// @deprecated Use `b`',
      '// TODO: remove',
      '// ---- Helpers ----',
      '// const old = 1',
    ].map((comment) => code(comment, 'export const a = 1')),
    // `//` notes directly above a doc block stay, as a fix of a trailing note leaves them
    code('// in px', '/**', ' * The size', ' */', 'export const size = 1'),
    code('// A note', '/** The x */ // NOSONAR', 'export const x = 1'),
    // Module headers, at the top, also right above an import or after a BOM, or after the imports
    code('/**', ' * Header.', ' */', '', 'const a = 1'),
    `\u{FEFF}${code('/**', ' * Header.', ' */', "import a from 'a'")}`,
    code("import a from 'a'", '', '/**', ' * Header.', ' */', '', "describe('a', () => {})"),
    // JSX comments: single-line, or starred when multi-line
    { code: code('const x = <div>{/* Note. */}</div>'), filename: 'x.tsx' },
    { code: code('const x = <div>{/*', ' * Note.', ' */}</div>'), filename: 'x.tsx' },
    { code: code('const x = <div>{/** @type {string} */ (y)}</div>'), filename: 'x.jsx' },
    code('const b = 1', '/**', ' * A.', ' */', '@dec', 'export class C {}'),
    {
      code: code('---', '/**', ' * Doc.', ' */', 'const a = 1', '---', '<p>{a}</p>'),
      ...astroOptions,
    },
    // Plain `/*` blocks and bundler magic comments are never reported or rewritten
    code("const m = import(/** webpackIgnore: true */ './b.js')"),
    code('/* Plain', '   block. */', 'function f() {}'),
    // Prose that starts with a directive's word isn't a directive
    code('/**', ' * global state of the store', ' */', 'export const a = 1'),
    ...['\r\n', '\r', '\u{2028}', '\u{2029}'].map((eol) =>
      ['export const a = 1', '/**', ' * Doc', ' */', 'export const b = 2', ''].join(eol),
    ),
    // TypeScript reads JSDoc on declaring assignments in JavaScript files
    ...DECLARING_ASSIGNMENTS.flatMap((source) => [
      { code: source, filename: 'x.js' },
      { code: withLineComment(source), filename: 'x.js' },
    ]),
    // TypeScript reads a doc block past a blank line, as on hover and in a `.d.ts`
    code('type H = 1', '', '/**', ' * Options', ' */', '', 'export type O = { h: H }'),
    // Only the nearest doc block attaches, and the one above it stays a module header
    code('/**', ' * Header.', ' */', '', '/**', ' * Doc.', ' */', '', 'export const a = 1'),
    // Everyday comments
    ...[
      code('// https://vite.dev/config/', 'export default {}'),
      code("/** @import { A } from 'a' */", '/**', ' * The x.', ' */', 'export const x = 1'),
      code('f()', '', '// SPDX-License-Identifier: Apache-2.0', 'export const b = 1'),
      code('f()', '', '/**', ' * Copyright (c) 2020 A.', ' */', 'f()'),
      // TypeScript doesn't read JSDoc on a union constituent, so only a type alias's own union
      // needs doc blocks
      code('type U = Array<', "  | 'a'", '  // Note.', "  | 'b'", '>'),
      // Only ESLint's suppressing and environment directives are ambiguous in a multi-line block
      code('/**', ' * eslint config for the repo', ' */', 'export const a = 1'),
    ].map((source) => ({ code: source, filename: 'x.ts' })),
  ],
  invalid: [
    // A prose `//` comment above a declaration or member may label a section, so only a
    // suggestion makes it a doc block
    ...[
      [
        code('// Parses the input.', 'export function parse() {}'),
        code('/**', ' * Parses the input.', ' */', 'export function parse() {}'),
      ],
      [
        code('interface I {', '  // Member.', '  a: string', '}'),
        code('interface I {', '  /**', '   * Member.', '   */', '  a: string', '}'),
      ],
      // The extra slashes of `///` comments are dropped
      [
        code('/// Adds two numbers', '/// returns sum', '///', 'export const add = 1'),
        code('/**', ' * Adds two numbers', ' * returns sum', ' */', 'export const add = 1'),
      ],
      // A directive below the comment stays below the doc block
      [
        code('// Doc.', '// cspell:disable-next-line', 'const a = 1'),
        code('/**', ' * Doc.', ' */', '// cspell:disable-next-line', 'const a = 1'),
      ],
      // A run of a doc block and `//` lines is one doc block, in order
      [
        code('class C {', '  // One', '  /** Two */', '  // Three', '  a = 1', '}'),
        code('class C {', '  /**', '   * One', '   * Two', '   * Three', '   */', '  a = 1', '}'),
      ],
      // A comment above a decorated class is anchored on the first decorator
      [
        code('// A.', '@one', '@two()', 'export default class C {}'),
        code('/**', ' * A.', ' */', '@one', '@two()', 'export default class C {}'),
      ],
      // A namespace alias is a declaration, unlike a CommonJS import
      [code('// Alias.', 'import B = A.B'), code('/**', ' * Alias.', ' */', 'import B = A.B')],
      // Suggestions keep the line ending of the comment's line
      ['// One.\r\nexport const a = 1\r\n', '/**\r\n * One.\r\n */\r\nexport const a = 1\r\n'],
      [
        'const c = 2\r\nconst b = 1\n// One.\nexport const a = 1\n',
        'const c = 2\r\nconst b = 1\n/**\n * One.\n */\nexport const a = 1\n',
      ],
      ...['\r', '\u{2028}', '\u{2029}'].map((eol) => [
        ['// x', 'export const a = 1', ''].join(eol),
        ['/**', ' * x', ' */', 'export const a = 1', ''].join(eol),
      ]),
    ].map(([source = '', output = '']) => toDoc(source, output)),
    toDoc(
      code('---', '// Doc.', 'const a = 1', '---', '', '<p>{a}</p>'),
      code('---', '/**', ' * Doc.', ' */', 'const a = 1', '---', '', '<p>{a}</p>'),
      astroOptions,
    ),
    // TypeScript ignores a doc block before a member on its line, so a suggestion moves it above
    suggests(
      code('type P = { /** The size */ size: number }'),
      'sameLine',
      'toOwnLine',
      code('type P = {', '  /**', '   * The size', '   */', '  size: number }'),
    ),
    // TypeScript would read a tagged block on its own line, such as a JSDoc type annotation
    {
      code: code('const o = { /** @type {number} */ size: 1 }'),
      output: null,
      filename: 'x.js',
      errors: [{ messageId: 'sameLine', suggestions: [] }],
    },
    // A suggestion moves code after the block to its own line, without the space before it
    suggests(
      code('class C {', '  // One', '  /** Two */  a = 1', '}'),
      'layout',
      'toLayout',
      code('class C {', '  // One', '  /**', '   * Two', '   */', '  a = 1', '}'),
    ),
    // A suggestion moves a `//` comment after a doc block on its line above it
    suggests(
      code('/** The size */ // in px', 'export const size = 1'),
      'trailingNote',
      'toNoteLine',
      code('// in px', '/** The size */', 'export const size = 1'),
    ),
    // Reported without a fix or suggestion
    ...[
      // Moving the member off its line would move it out of a line directive's reach
      [code('// eslint-disable-next-line no-var', 'const o = { /** s */ size: 1 }'), 'sameLine'],
      [code('// Matches `*/` at the end', 'export const END = "*/"'), 'docTerminator'],
      ...SECURITY_DIRECTIVES.map((directive) => [`/** ${directive} */\nf()`, 'notDirective']),
      // The `/* */` fix keeps the strict check
      [code('f(/**', ' * global a, b', ' */ 1)'), 'notDoc'],
      // A slash before text can't be told apart from the extra slashes of `///`
      [code('// One', '///path/to/file', 'export const a = 1'), 'docByHand'],
      // A block between `@ts-expect-error` and its line would make TypeScript read it there, and
      // TypeScript skips blank lines and `//` comments between them
      [
        code('// @ts-expect-error', '// The answer.', 'export const a: string = 1'),
        'docBelowTsDirective',
      ],
      [
        code('/// @ts-expect-error', '', '// The answer.', 'export const a = 1'),
        'docBelowTsDirective',
      ],
      [
        code('// The answer.', '// @ts-expect-error', '// More.', 'export const a = 1'),
        'docBelowTsDirective',
      ],
      [
        code('// @ts-expect-error', '', '// The value', 'export const a: string = 1', ''),
        'docBelowTsDirective',
      ],
      [code('// @ts-ignore', '/** The answer. */', 'export const a: string = 1'), 'layout'],
      // TypeScript reads `@ts-expect-error` on a block's last line, which a fix would move
      [code('/** Note', ' * @ts-expect-error */', 'export const x: string = 1'), 'layout'],
      // A block between `@ts-expect-error` and its line
      [
        code(
          'export function f() {',
          '// @ts-expect-error',
          '/** n */',
          'const a: string = 1',
          'return a',
          '}',
          '',
        ),
        'notDoc',
      ],
      // A `@ts-expect-error` before code on its line applies to the next line, so a change of the
      // number of lines on its line moves what it applies to
      [
        code(
          '/* @ts-expect-error -- deliberate */ export const p = { c: 1, /** e */ d: 2 }',
          'export const z: string = 1',
          '',
        ),
        'sameLine',
      ],
      // Lines that mix ` * ` prefixes with lines without them, a star typo, or a `*` starting every
      // line's text, which may be text or a prefix
      [code('/**', ' * Loads the config and', '   falls back', ' */', 'const a = 1'), 'layout'],
      [code('f()', '/**', ' * One', ' *b', ' */', 'f()'), 'notDoc'],
      [code('/**Note**: keep this', '   in sync */', 'export const a = 1'), 'layout'],
      // A doc block that a fix to `//` or `/*` would make a directive, on its first or a later line
      [code('/** eslint-disable-next-line no-debugger */', 'debugger'), 'notDirective'],
      [code('/** global foo */', 'foo()'), 'notDirective'],
      ...['eslint no-console: off', 'prettier-ignore', 'biome-ignore lint: x', 'jscs:disable'].map(
        (text) => [code('f()', `/** ${text} */`, 'f()'), 'notDirective'],
      ),
      [
        code('f()', '/**', ' * Note', ' * eslint-disable-next-line no-debugger', ' */', 'f()'),
        'notDoc',
      ],
      [code('f()', '/**', ' * Note', ' *   prettier-ignore', ' */', 'f()'), 'notDoc'],
      [code('[1].map(/** istanbul ignore next */ (x) => x)'), 'notDirective'],
      [code('const x = <div>{/** #region */}</div>'), 'jsxLayout', 'x.tsx'],
      // A JSX fix reads the stars of a banner as text
      [code('const x = <div>{/*** banner ***/}</div>'), 'jsxLayout', 'x.tsx'],
      // A line terminator other than LF or CRLF in a block
      ...['\u{2028}', '\u{2029}', '\r'].map((eol) => [
        code('function f(a) {', `  /** first${eol}return a + 1 */`, '  return a', '}'),
        'notDoc',
      ]),
      // A tagged doc block, a `//` line with a tag, or a directive after a doc block in a run
      [code('/** @deprecated use b */', '// note', 'export const a = 1'), 'docByHand'],
      [
        code('// Doc for a', '// @returns {number} the value', 'export function a() {}'),
        'docByHand',
      ],
      [code('/** a */', '// b', '/** The x */ // NOSONAR', 'export const x = 1'), 'docByHand'],
    ].map(([source = '', messageId = '', filename]) =>
      fixes(source, null, messageId, filename === undefined ? {} : { filename }),
    ),
    // Fixed
    ...[
      // Declaring assignments take JSDoc only in JavaScript files
      ...DECLARING_ASSIGNMENTS.map((source) => [source, withLineComment(source), 'notDoc']),
      // ESLint reads `global` only in a `/*` block, so as a `//` line it's prose
      [
        code('function f() {', '  /**', '   * global cache', '   */', '  return 1', '}'),
        code('function f() {', '  // global cache', '  return 1', '}'),
        'notDoc',
      ],
      // Indented code after text on the `/**` line keeps its indentation relative to that text,
      // and text aligned under it isn't indented
      [
        code('/** Usage:', ' *     run()', ' */', 'export const x = 1'),
        code('/**', ' * Usage:', ' *    run()', ' */', 'export const x = 1'),
        'layout',
      ],
      [
        code('/** One', ' *  two', ' */', 'export const x = 1'),
        code('/**', ' * One', ' * two', ' */', 'export const x = 1'),
        'layout',
      ],
      // A doc block on the line of what isn't a member or parameter isn't attached to it
      ["type A = /** a */ 'x' | 'y'", "type A = /* a */ 'x' | 'y'", 'notDoc'],
      ['type P = { size: /** b */ number }', 'type P = { size: /* b */ number }', 'notDoc'],
      [
        'const b = 1\r\nfunction f() {\n  /** One.\n      Two. */\n  return 1\n}\n',
        'const b = 1\r\nfunction f() {\n  // One.\n  // Two.\n  return 1\n}\n',
        'notDoc',
      ],
      // A banner's rule line, whose `*` no space follows, keeps its text, and a star banner loses
      // its extra stars in one pass
      [
        code('f()', '/**', ' * Buttons', ' *-----', ' */', 'f()'),
        code('f()', '// Buttons', '// -----', 'f()'),
        'notDoc',
      ],
      [
        code('f()', '/****', ' * Buttons', ' ****/', 'f()'),
        code('f()', '// Buttons', 'f()'),
        'notDoc',
      ],
      // The parameter of an arrow function without parentheses starts the function, which takes
      // the comment
      [
        code('f(', '  /** Note. */', '  x => x,', ')'),
        code('f(', '  // Note.', '  x => x,', ')'),
        'notDoc',
      ],
      [
        code("import a from 'a'", '/**', ' * Import.', ' */', "import b = require('b')"),
        code("import a from 'a'", '// Import.', "import b = require('b')"),
        'notDoc',
      ],
      // A block above a later import isn't the module header
      [
        code("'use client'", '/**', ' * Import.', ' */', "import a from 'a'"),
        code("'use client'", '// Import.', "import a from 'a'"),
        'notDoc',
      ],
      // With two doc blocks on a line, the last is the doc
      [
        code('const y = 1', '/** a */ /** b */', 'export const x = 1'),
        code('const y = 1', '/* a */ /** b */', 'export const x = 1'),
        'notDoc',
      ],
      [
        code('/** One */', '/** Two */', 'export const a = 1'),
        code('/**', ' * One', ' * Two', ' */', 'export const a = 1'),
        'doc',
      ],
      [code('/** Doc. */', 'const a = 1'), code('/**', ' * Doc.', ' */', 'const a = 1'), 'layout'],
      [
        code('function f(', '  /** The x. */', '  x: string,', ') {}'),
        code('function f(', '  /**', '   * The x.', '   */', '  x: string,', ') {}'),
        'layout',
      ],
      [
        code('type T = {', '  /**', '  One.', '', '  Two.', '  */', '  a: 1', '}'),
        code('type T = {', '  /**', '   * One.', '   *', '   * Two.', '   */', '  a: 1', '}'),
        'layout',
      ],
    ].map(([source = '', output = '', messageId = '']) => fixes(source, output, messageId)),
    {
      ...fixes(
        code('/**', '@type {number}', '*/', 'export default 1'),
        code('/**', ' * @type {number}', ' */', 'export default 1'),
        'layout',
      ),
      filename: 'x.js',
    },
    // A doc block detached by a blank line is laid out as an attached one, and never becomes `//`
    fixes(
      code('const a = 1', '', '/** Options', ' *  more */', '', 'export type O = {}'),
      code('const a = 1', '', '/**', ' * Options', ' * more', ' */', '', 'export type O = {}'),
      'layout',
    ),
    (() => {
      // `this` in an arrow function isn't the instance a constructor makes
      const source = code('const f = () => {', '  /**', '   * x', '   */', '  this.x = 1', '}')
      return fixes(source, withLineComment(source), 'notDoc', { filename: 'x.js' })
    })(),
    ...[
      [
        code('export const x = <div', '  /**', '   * a', '   */', '  id="x"', '/>'),
        code('export const x = <div', '  /*', '   * a', '   */', '  id="x"', '/>'),
      ],
      [code('const x = <div>{/** */}</div>'), code('const x = <div>{/* */}</div>')],
      [code('const x = <div>{/** Note. */}</div>'), code('const x = <div>{/* Note. */}</div>')],
    ].map(([source = '', output = '']) =>
      fixes(source, output, 'jsxLayout', { filename: 'x.tsx' }),
    ),
  ],
})

describe('comment-layout fixes', () => {
  const linter = new Linter({ configType: 'flat' })
  const config: Linter.Config = {
    // Without `files`, ESLint lints only JavaScript files
    files: ['**/*.ts'],
    plugins: { '@gpahal': GPAHAL_PLUGIN },
    languageOptions: { parser: tsEslintParser },
    rules: { '@gpahal/comment-layout': 'error' },
  }
  const tsxConfig: Linter.Config = {
    ...config,
    files: ['**/*.tsx'],
    languageOptions: { parser: tsEslintParser, parserOptions: { ecmaFeatures: { jsx: true } } },
  }
  const unusedConfig: Linter.Config = {
    ...config,
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: { ...config.rules, 'no-unused-vars': 'error' },
  }

  /**
   * `source` with every fix, then every suggestion, of the comment-layout messages applied, one
   * pass each, the later edits first, as long as none overlap
   */
  function withAllChanges(source: string, lintConfig: Linter.Config, filename: string): string {
    const fixed = linter.verifyAndFix(source, lintConfig, filename).output
    const edits = linter
      .verify(fixed, lintConfig, filename)
      .flatMap((message) => (message.suggestions ?? []).map((suggestion) => suggestion.fix))
      .toSorted((a, b) => b.range[0] - a.range[0])
    let result = fixed
    for (const edit of edits) {
      result = `${result.slice(0, edit.range[0])}${edit.text}${result.slice(edit.range[1])}`
    }
    return result
  }

  it('keep a next-line directive before an attached comment', () => {
    const source = code('class A {', '/* eslint-disable-next-line no-var */ // Doc', 'x = 1', '}')
    const result = linter.verifyAndFix(
      source,
      {
        ...config,
        rules: { ...config.rules, 'no-var': 'error' },
        linterOptions: { reportUnusedDisableDirectives: false },
      },
      'x.ts',
    )
    expect(result.output).toBe(source)
    expect(result.messages).toEqual([expect.objectContaining({ messageId: 'docByHand' })])
    expect(result.messages[0]?.suggestions).toBeUndefined()
  })

  it.each([
    code('enum E { /** One */ A, /** Two */ B }'),
    code('class C {', '  a = 1; /** The', '   * size **/ size = 1', '}'),
  ])('suggest moving a doc block off the line of the member it precedes: %j', (source) => {
    expect(linter.verifyAndFix(source, config, 'x.ts').fixed).toBe(false)
    const output = withAllChanges(source, config, 'x.ts')
    expect(linter.verify(output, config, 'x.ts')).toEqual([])
    expect(output).not.toBe(source)
    expect(output.replaceAll(/\s/g, '').replaceAll(/\/\*.*?\*\//g, '')).toBe(
      source.replaceAll(/\s/g, '').replaceAll(/\/\*.*?\*\//g, ''),
    )
  })

  // `@ts-nocheck` applies to the whole file, not to the line below it
  it('fix the comments below `@ts-nocheck`', () => {
    expect(
      linter.verifyAndFix(code('f()', '// @ts-nocheck', '/** note */', 'f()'), config, 'x.ts')
        .output,
    ).toBe(code('f()', '// @ts-nocheck', '// note', 'f()'))
  })

  it('keep the code on the line `eslint-disable-next-line` targets', () => {
    const source = code(
      '// eslint-disable-next-line no-unused-vars -- intentional',
      '/** explanation */ const unused = 1',
    )
    const { output } = linter.verifyAndFix(source, unusedConfig, 'x.ts')
    expect(output).toContain('// eslint-disable-next-line no-unused-vars -- intentional')
    const messages = linter.verify(output, unusedConfig, 'x.ts')
    expect(messages.filter((message) => message.ruleId !== '@gpahal/comment-layout')).toEqual([])
  })

  it('move an `eslint-disable-line` after the code with the code', () => {
    const source = code('/** a */ const x = 1 // eslint-disable-line no-unused-vars', '')
    const output = withAllChanges(source, unusedConfig, 'x.ts')
    expect(output).toBe(
      code('/**', ' * a', ' */', 'const x = 1 // eslint-disable-line no-unused-vars', ''),
    )
    expect(linter.verify(output, unusedConfig, 'x.ts')).toEqual([])
  })

  it.each([
    code('/** Header.', ' * More. */', "import a from 'a'", '', 'export const b = a'),
    `\u{FEFF}${code('/**', '   Header.', '*/', "import a from 'a'", '', 'a()')}`,
  ])('keep a module header right above an import as a block, in one pass: %j', (source) => {
    const { output, messages } = linter.verifyAndFix(source, config, 'x.ts')
    expect(messages).toEqual([])
    expect(output).toMatch(/^\u{FEFF}?\/\*\*\n \* Header\.\n(?: \* More\.\n)? \*\/\nimport/u)
    expect(linter.verifyAndFix(output, config, 'x.ts').fixed).toBe(false)
  })

  const prettierConfig = definePrettierConfig({ root: path.resolve(import.meta.dirname, '..') })

  it.each([
    code('export const x = (', '  <div>', '    {/* One', '       two. */}', '  </div>', ')', ''),
    code('export const x = <div', '  /**', '   * a', '   */', '  id="x"', '/>'),
  ])('agree with Prettier on the layout of the multi-line JSX comment in %j', async (source) => {
    const format = async (text: string) =>
      prettier.format(text, { ...prettierConfig, filepath: 'x.tsx' })
    const fix = (text: string) => linter.verifyAndFix(text, tsxConfig, 'x.tsx').output
    const once = await format(fix(await format(source)))
    expect(fix(once)).toBe(once)
    expect(await format(fix(once))).toBe(once)
  })

  it('report comments in Astro scripts without changing them', async () => {
    const source = code(
      '---',
      'const x = 1',
      '---',
      '<div>{x}</div>',
      '<script>',
      '  /** script doc */',
      '  const y = 1',
      '  const o = { a: y, /** b */ b: 2 }',
      '  console.warn(o)',
      '</script>',
      '',
    )
    const eslint = await createESLint(
      'astro-untyped',
      { ...CORE_AREAS_OFF, astro: true },
      { fix: true, ruleFilter: ({ ruleId }) => ruleId === '@gpahal/comment-layout' },
    )
    const emitWarning = vi.spyOn(process, 'emitWarning')
    try {
      const [result] = await eslint.lintText(source, {
        filePath: path.join(FIXTURES_DIR, 'astro-untyped', 'x.astro'),
      })
      expect(result?.output).toBeUndefined()
      expect(
        result?.messages
          .filter((message) => message.ruleId === '@gpahal/comment-layout')
          .map((message) => [message.messageId, message.suggestions]),
      ).toEqual([
        ['layout', undefined],
        ['sameLine', undefined],
      ])
      expect(emitWarning).not.toHaveBeenCalled()
    } finally {
      emitWarning.mockRestore()
    }
  })
})

/**
 * A file of `count` calls, each with a doc block above it
 */
function notesBeforeCalls(count: number): string {
  return Array.from({ length: count }, (_, index) => `/** note */\nf${index}()\n`).join('')
}

/**
 * The work `comment-layout` does on `text`, less that of a lint with the rule off, so parsing
 * doesn't hide how the rule scales
 */
function ruleWork(text: string): number {
  const linter = new Linter({ configType: 'flat' })
  const workOf = (severity: Linter.RuleSeverity) =>
    countWork(() =>
      linter.verify(
        text,
        {
          files: ['**/*.ts'],
          plugins: { '@gpahal': GPAHAL_PLUGIN },
          languageOptions: { parser: tsEslintParser },
          rules: { '@gpahal/comment-layout': severity },
        },
        'x.ts',
      ),
    )
  return workOf('error') - workOf('off')
}

describe('comment-layout scaling', () => {
  // 10 times the input takes 10 times the work in linear code, and 100 times in quadratic code. A
  // binary search adds a little, so the bound is 15 times
  it.each([
    ['doc blocks', notesBeforeCalls],
    [
      'a run of `//` comments',
      (count: number) => `${'// x\n'.repeat(count * 2)}export const a = 1\n`,
    ],
  ] as const)('avoid quadratic scaling with the count of %s', (_name, source) => {
    expect(ruleWork(source(5000))).toBeLessThan(15 * ruleWork(source(500)))
  })

  // A spread of more items than the runtime's argument limit throws `RangeError: Maximum call
  // stack size exceeded`; generated or imported text can hold runs this long
  it.each([
    `${'// text\n'.repeat(130_000)}const value = 1\n`,
    `/**\n${' * line\n'.repeat(130_000)} */\n// text\nconst value = 1\n`,
  ])('report a very long comment run without overflowing the call stack', (source) => {
    const linter = new Linter({ configType: 'flat' })
    const config: Linter.Config = {
      plugins: { '@gpahal': GPAHAL_PLUGIN },
      rules: { '@gpahal/comment-layout': 'error' },
    }
    expect(linter.verify(source, config, 'x.js').map(({ ruleId }) => ruleId)).toContain(
      '@gpahal/comment-layout',
    )
  })
})

/**
 * Code that comments go into, at each whitespace or punctuation offset
 */
const SKELETONS = [
  'export const x = { a: 1, b: () => 2 }',
  'export type T = | "a" | "b"',
  'class C { constructor(private readonly x: number) {} @dec m() {} y = 1 }',
  'const el = <div a="1">{y}<span /></div>',
  'import a from "a"\nexport { a }',
]

const COMMENTS = [
  '/** doc */',
  '/** a\n b */',
  '// line',
  '/// triple',
  '/**\r\n * crlf\r\n */',
  '// @ts-expect-error',
  '/** eslint-disable-next-line */',
  '/** a */ // b',
  '/** x\u{2028}y */',
  '/*\n * jsx\n */',
]

const PREFIXES = ['', '\u{FEFF}', '#!/usr/bin/env node\n', '// @ts-expect-error\n']

const SEPARATORS = [' ', '\n']

/**
 * Each skeleton with each comment at each offset, after one of the prefixes and between one of the
 * separators in turn, so each prefix and separator meets each comment without the run crossing
 * every prefix and separator with every case
 */
const COMMENT_CASES = SKELETONS.flatMap((skeleton) => {
  const offsets = [
    ...new Set([0, ...skeleton.matchAll(/[\s(){}<>,;:=|]/gu).map((match) => match.index)]),
  ]
  return offsets.flatMap((offset, offsetIndex) =>
    COMMENTS.map((comment, commentIndex) => {
      const prefix = PREFIXES[(offsetIndex + commentIndex) % PREFIXES.length] ?? ''
      const separator = SEPARATORS[offsetIndex % SEPARATORS.length] ?? ''
      return `${prefix}${skeleton.slice(0, offset)}${separator}${comment}${separator}${skeleton.slice(offset)}`
    }),
  )
})

/**
 * The tokens of `code` other than comments, or `undefined` when it doesn't parse
 */
function codeTokens(code: string): string | undefined {
  try {
    const { ast } = parseForESLint(code, { ecmaFeatures: { jsx: true }, filePath: 'x.tsx' })
    return ast.tokens.map((token) => `${token.type}:${token.value}`).join(' ')
  } catch {
    return undefined
  }
}

describe('comment-layout on comments in odd places', () => {
  const linter = new Linter({ configType: 'flat', cwd: path.parse(process.cwd()).root })
  const config: Linter.Config = {
    files: ['**/*.tsx'],
    plugins: { '@gpahal': GPAHAL_PLUGIN },
    languageOptions: { parser: tsEslintParser, parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: { '@gpahal/comment-layout': 'error' },
  }

  it('keeps the code, re-parses and settles in one pass after --fix', () => {
    const failures: Array<string> = []
    let count = 0
    for (const code of COMMENT_CASES) {
      const tokens = codeTokens(code)
      if (tokens === undefined) {
        continue
      }
      count++
      const { output, fixed } = linter.verifyAndFix(code, config, { filename: 'x.tsx' })
      if (!fixed) {
        continue
      }
      if (codeTokens(output) !== tokens) {
        failures.push(`changed the code: ${JSON.stringify(code)}`)
      } else if (linter.verifyAndFix(output, config, { filename: 'x.tsx' }).fixed) {
        failures.push(`a second pass changed: ${JSON.stringify(code)}`)
      }
    }
    expect(count).toBeGreaterThan(400)
    expect(failures).toEqual([])
  })
})
