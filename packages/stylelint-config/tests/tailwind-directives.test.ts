import stylelint from 'stylelint'

import { defineConfig } from '@/index'

import { tailwindProblemOf } from './helpers'

/**
 * Tailwind's problem with `css` after `@import 'tailwindcss'`
 */
async function problemOf(css: string): Promise<string | undefined> {
  return tailwindProblemOf(`@import 'tailwindcss';\n${css}`)
}

const config = await defineConfig({ root: import.meta.dirname, tailwindcss: true })

/**
 * The messages of `@gpahal/tailwind-directives` on `css`
 */
async function reportsOf(css: string): Promise<Array<string>> {
  const { results } = await stylelint.lint({ code: css, config, codeFilename: 'a.css' })
  return results.flatMap((result) =>
    result.warnings
      .filter((warning) => warning.rule === '@gpahal/tailwind-directives')
      .map((warning) => warning.text.replace(/ \(@gpahal\/tailwind-directives\)$/, '')),
  )
}

describe('@gpahal/tailwind-directives', () => {
  it.each([
    ['@source;\n', 'Expected a prelude for "@source"'],
    ['.b {\n  @apply;\n}\n', 'Expected a prelude for "@apply"'],
    ['@custom-variant foo;\n', 'Expected a selector or a body in "@custom-variant foo"'],
    [
      '@custom-variant baz (&:hover) {\n  @slot;\n}\n',
      'Unexpected selector and body in "@custom-variant baz", which takes one of them',
    ],
    ['@custom-variant foo ();\n', 'Unexpected empty selector in "@custom-variant foo"'],
    [
      '@custom-variant Foo (&:hover);\n',
      'Unexpected invalid variant name "Foo": a variant name starts with a lowercase letter or digit, has only letters, digits, "-" and "_", and doesn\'t end with "-" or "_"',
    ],
    [
      '@media print {\n  @custom-variant foo (&:hover);\n}\n',
      'Unexpected nested "@custom-variant", which must be at the root',
    ],
    [
      '@utility Foo-Bar {\n  color: red;\n}\n',
      'Unexpected invalid utility name "Foo-Bar": a utility name starts with a lowercase letter and has only letters, digits, "-" and "_"',
    ],
    [
      '@utility foo-*-bar {\n  color: red;\n}\n',
      'Unexpected invalid utility name "foo-*-bar": "-*" goes once, at the end',
    ],
    ['@utility foo;\n', 'Expected a declaration in "@utility foo"'],
    [
      '@utility a {\n  color: red;\n\n  @utility b {\n    color: red;\n  }\n}\n',
      'Unexpected nested "@utility", which must be at the root',
    ],
    [
      '@variant hover: {\n  a {\n    color: red;\n  }\n}\n',
      'Unexpected empty variant in "@variant"',
    ],
    [
      '.b {\n  color: --alpha(var(--c) / 50%, x);\n}\n',
      'Unexpected second argument in "--alpha()"',
    ],
    [
      '@utility tab-* {\n  tab-size: --value(integr);\n}\n',
      'Unexpected unknown data type "integr" in "--value()". Use "number", "integer", "ratio", "percentage", a "[type]", a "--namespace-*" or a quoted value',
    ],
  ])('reports what fails Tailwind, in %j', async (css, message) => {
    expect(await problemOf(css)).toBeDefined()
    expect(await reportsOf(css)).toEqual([message])
  })

  it.each([
    '@source "../src";\n@source not "../legacy";\n@source inline("underline");\n',
    '@custom-variant dark (&:where(.dark, .dark *));\n',
    '@custom-variant hocus {\n  &:hover,\n  &:focus {\n    @slot;\n  }\n}\n',
    '@custom-variant 3xl (@media (width >= 120rem));\n',
    // Tailwind reads an escape of one hex digit as the digit
    '@utility tab\\0 {\n  tab-size: 4;\n}\n',
    '@utility w-1/2 {\n  width: 50%;\n}\n',
    '@utility tab-* {\n  tab-size: --value(integer, [integer], --tab-size-*, "x");\n  opacity: --modifier(percentage);\n}\n',
    '@variant hocus (&:hover, &:focus);\n',
    '.card {\n  color: --alpha(var(--color-red-500) / 50%);\n\n  @variant hover:focus {\n    color: red;\n  }\n\n  @apply flex;\n}\n',
  ])('takes what Tailwind compiles, in %j', async (css) => {
    expect(await problemOf(css)).toBeUndefined()
    expect(await reportsOf(css)).toEqual([])
  })

  // `String.fromCodePoint()` throws on a code point above U+10FFFF
  it.each([String.raw`\110000`])(
    'reads an escape %s that is no code point as U+FFFD, as Tailwind does',
    async (escape) => {
      const css = `@utility foo${escape} {\n  color: red;\n}\n`
      expect(await problemOf(css)).toBeDefined()
      expect(await reportsOf(css)).toEqual([
        `Unexpected invalid utility name "foo${escape}": a utility name starts with a lowercase letter and has only letters, digits, "-" and "_"`,
      ])
    },
  )

  it('checks --alpha() in a value with an added Tailwind function, which the type check skips', async () => {
    const added = await defineConfig({
      root: import.meta.dirname,
      tailwindcss: { functions: (defaults) => [...defaults, 'my-fn'] },
    })
    const { results } = await stylelint.lint({
      code: '.a {\n  color: --alpha(red / ) my-fn(1);\n}\n',
      config: added,
      codeFilename: 'a.css',
    })
    expect(
      results[0]?.warnings
        .filter((warning) => /tailwind-directives|value-no-unknown/.test(warning.rule))
        .map((warning) => warning.rule),
    ).toEqual(['@gpahal/tailwind-directives'])
  })

  // Tailwind skips it, so it does nothing
  it('reports an empty @reference', async () => {
    expect(await reportsOf('@reference;\n')).toEqual(['Expected a prelude for "@reference"'])
  })
})
