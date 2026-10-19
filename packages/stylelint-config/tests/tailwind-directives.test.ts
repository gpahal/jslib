import fs from 'node:fs/promises'
import path from 'node:path'

import stylelint from 'stylelint'
import { compile } from 'tailwindcss'

import { defineConfig } from '@/index'

const TAILWIND_DIR = await fs.realpath(
  path.join(import.meta.dirname, '../node_modules/tailwindcss'),
)

/**
 * Tailwind's `compile()` of `css` after `@import 'tailwindcss'`: `undefined` when it compiles
 * without a warning, or else its error or warning. It loads only Tailwind's own stylesheets and no
 * module, as for a path that doesn't exist
 */
async function tailwindProblemOf(css: string): Promise<string | undefined> {
  const warnings: Array<string> = []
  const warn = vi.spyOn(console, 'warn').mockImplementation((...args: Array<unknown>) => {
    warnings.push(args.map(String).join(' '))
  })
  try {
    const compiler = await compile(`@import 'tailwindcss';\n${css}`, {
      base: TAILWIND_DIR,
      loadStylesheet: async (id: string) => {
        const file = id === 'tailwindcss' ? path.join(TAILWIND_DIR, 'index.css') : id
        if (!file.startsWith(TAILWIND_DIR)) throw new Error(`Can't resolve '${id}'`)
        return { path: file, base: path.dirname(file), content: await fs.readFile(file, 'utf8') }
      },
      loadModule: async (id: string) => {
        throw new Error(`Can't resolve '${id}'`)
      },
    })
    compiler.build(['flex'])
    return warnings[0]
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  } finally {
    warn.mockRestore()
  }
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
    expect(await tailwindProblemOf(css)).toBeDefined()
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
    expect(await tailwindProblemOf(css)).toBeUndefined()
    expect(await reportsOf(css)).toEqual([])
  })

  // `String.fromCodePoint()` throws on a code point above U+10FFFF
  it.each([String.raw`\110000`])(
    'reads an escape %s that is no code point as U+FFFD, as Tailwind does',
    async (escape) => {
      const css = `@utility foo${escape} {\n  color: red;\n}\n`
      expect(await tailwindProblemOf(css)).toBeDefined()
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

  it("is off without tailwindcss, and on in Markdown's code blocks", async () => {
    const plain = await defineConfig({ root: import.meta.dirname })
    const { results } = await stylelint.lint({
      code: '.b {\n  @apply;\n}\n',
      config: plain,
      codeFilename: 'a.css',
    })
    expect(results[0]?.warnings.map((warning) => warning.rule)).not.toContain(
      '@gpahal/tailwind-directives',
    )
    const markdown = await stylelint.lint({
      code: '# A\n\n```css\n@source;\n```\n',
      config,
      codeFilename: 'a.md',
    })
    expect(markdown.results[0]?.warnings.map((warning) => warning.rule)).toContain(
      '@gpahal/tailwind-directives',
    )
  })
})
