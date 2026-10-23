import fs from 'node:fs/promises'
import path from 'node:path'

import stylelint from 'stylelint'
import type { Config } from 'stylelint'

import { withTmpProject } from '@gpahal/internal/node/testing'

import { defineConfig } from '@/index'

import { linkTailwind, tailwindProblemOf } from './helpers'

const ENTRY = [
  "@import 'tailwindcss';",
  "@import './components.css';",
  "@plugin './plugin.js';",
  '',
  '@custom-variant pointer-fine (@media (pointer: fine));',
  '',
  '@utility tab-4 {',
  '  tab-size: 4;',
  '}',
  '',
  '@theme {',
  '  --color-brand: red;',
  '}',
  '',
  // Errors of the entry point's own rules don't stop its design system from loading
  '.card {',
  '  color: theme(--color-nope);',
  '',
  '  @apply nope-class;',
  '}',
  '',
].join('\n')

/**
 * A Tailwind plugin module that adds the utility `.<name>`
 */
function plugin(name: string): string {
  return `export default { handler: ({ addUtilities }) => addUtilities({ '.${name}': { color: 'red' } }) }\n`
}

const project = await withTmpProject('stylelint-config-tailwind-apply', {
  'src/global.css': ENTRY,
  'src/components.css': '@utility btn {\n  padding: 1rem;\n}\n\n.x {\n  @apply also-nope;\n}\n',
  'src/plugin.js':
    "export default { handler: ({ addUtilities }) => addUtilities({ '.plugin-util': { color: 'red' } }) }\n",
  'prefixed/global.css': "@import 'tailwindcss' prefix(tw);\n",
  'broken/global.css': "@import 'tailwindcss';\n@plugin 'missing-plugin';\n",
  // A symlinked entry point, whose imports resolve from its real path
  'shared/colors.css': '@utility shared-util {\n  color: red;\n}\n',
  'shared/entry.css': "@import 'tailwindcss';\n@import './colors.css';\n",
  // Plugins resolved as Tailwind resolves them
  'modules/global.css':
    "@import 'tailwindcss';\n@plugin './ext-plugin';\n@plugin './plugin-dir';\n@plugin 'esm-plugin';\n",
  'modules/ext-plugin.js': plugin('ext-util'),
  'modules/plugin-dir/index.js': plugin('dir-util'),
  'node_modules/esm-plugin/package.json':
    '{ "name": "esm-plugin", "type": "module", "exports": { ".": { "import": "./index.js" } } }\n',
  'node_modules/esm-plugin/index.js': plugin('esm-util'),
  // Ordinary rules after the last design at-rule, which has no block
  'trailing-plugin/global.css':
    "@import 'tailwindcss';\n@plugin './plugin.js';\n\n.a {\n  color: red;\n}\n",
  'trailing-plugin/plugin.js': plugin('trailing-plugin-util'),
  'trailing-import/global.css':
    "@import 'tailwindcss';\n@import './utils.css';\n\n.a {\n  color: red;\n}\n",
  'trailing-import/utils.css': '@utility trailing-import-util {\n  color: red;\n}\n',
  // Errors that Tailwind's `compile()` throws inside the design system's own at-rules
  'utility-error/global.css': [
    "@import 'tailwindcss';",
    '',
    '@utility bad {',
    '  @apply nope;',
    '}',
    '',
    '@utility bad-theme {',
    '  color: theme(--color-nope);',
    '',
    '  @variant nope-variant {',
    '    color: red;',
    '  }',
    '}',
    '',
    '@custom-variant bad-variant {',
    '  @media (width >= theme(--breakpoint-nope)) {',
    '    @apply also-nope;',
    '',
    '    @slot;',
    '  }',
    '}',
    '',
  ].join('\n'),
  // Tailwind would read `.env` as CSS, and its parse error would print the secret
  'secret/global.css': "@import 'tailwindcss';\n@import './secret.env';\n",
  'secret/secret.env': 'API_KEY={ topsecret\n',
})
await linkTailwind(project.dir)
await fs.mkdir(path.join(project.dir, 'linked-entry'))
await fs.symlink('../shared/entry.css', path.join(project.dir, 'linked-entry/global.css'))

afterAll(async () => {
  await project[Symbol.asyncDispose]()
})

/**
 * Whether Tailwind's `compile()` takes `@apply <candidate>` after `@import 'tailwindcss'`
 */
async function tailwindApplies(candidate: string): Promise<boolean> {
  return (
    (await tailwindProblemOf(`@import 'tailwindcss';\n.t {\n  @apply ${candidate};\n}\n`)) ===
    undefined
  )
}

/**
 * The messages of `@gpahal/tailwind-apply` on `code`, linted as `src/<file>` with `config`
 */
async function reportsOf(code: string, config: Config, file = 'a.css'): Promise<Array<string>> {
  const { results } = await stylelint.lint({
    code,
    config,
    codeFilename: path.join(project.dir, 'src', file),
  })
  return results.flatMap((result) =>
    result.warnings
      .filter((warning) => warning.rule === '@gpahal/tailwind-apply')
      .map((warning) => warning.text.replace(/ \(@gpahal\/tailwind-apply\)$/, '')),
  )
}

const config = await defineConfig({
  root: project.dir,
  tailwindcss: { entryPoint: 'src/global.css', validateApply: true },
})

describe('tailwindcss.validateApply', () => {
  it("reports the classes and variants that the entry point's design system doesn't know", async () => {
    const code = [
      '.a {',
      '  @apply flex hover:underline bg-brand tab-4 btn plugin-util pointer-fine:flex nope md:nope !important;',
      '}',
      '',
      '.b {',
      '  @variant hover {',
      '    color: red;',
      '  }',
      '',
      '  @variant pointer-fine:focus, data-[open]:nopevariant {',
      '    color: red;',
      '  }',
      '}',
      '',
    ].join('\n')
    expect(await reportsOf(code, config)).toEqual([
      'Unexpected unknown utility class "nope" in "@apply"',
      'Unexpected unknown utility class "md:nope" in "@apply"',
      'Unexpected unknown variant "nopevariant" in "@variant"',
    ])
  })

  it.each([
    ['bg-red-500/50', true],
    ['[color:red]', true],
    ['md:nope', false],
    ['nope:flex', false],
  ])('agrees with Tailwind on @apply %s', async (candidate, known) => {
    expect(await tailwindApplies(candidate)).toBe(known)
    expect(await reportsOf(`.a {\n  @apply ${candidate};\n}\n`, config)).toHaveLength(known ? 0 : 1)
  })

  it('skips comments in an @apply, as Tailwind does', async () => {
    const code = ".a {\n  @apply flex /* note: nope */ p-/* x */4 content-['/*a*/'] nope;\n}\n"
    expect(await tailwindApplies("flex /* note: nope */ p-/* x */4 content-['/*a*/']")).toBe(true)
    expect(await reportsOf(code, config)).toEqual([
      'Unexpected unknown utility class "nope" in "@apply"',
    ])
  })

  it.each([
    ['a symlinked entry point', 'linked-entry', 'shared-util'],
    ['extensionless, folder and ESM-only package plugins', 'modules', 'ext-util dir-util esm-util'],
    ['a @plugin that a rule follows', 'trailing-plugin', 'trailing-plugin-util'],
    ['an @import that a rule follows', 'trailing-import', 'trailing-import-util'],
  ])('loads %s as Tailwind does', async (_name, folder, classes) => {
    const loaded = await defineConfig({
      root: project.dir,
      tailwindcss: { entryPoint: `${folder}/global.css`, validateApply: true },
    })
    expect(await reportsOf(`.a {\n  @apply ${classes} nope;\n}\n`, loaded)).toEqual([
      'Unexpected unknown utility class "nope" in "@apply"',
    ])
  })

  it("doesn't read an import that isn't CSS", async () => {
    const secret = await defineConfig({
      root: project.dir,
      tailwindcss: { entryPoint: 'secret/global.css', validateApply: true },
    })
    expect(await reportsOf('.a {\n  @apply flex nope;\n}\n', secret)).toEqual([
      'Unexpected unknown utility class "nope" in "@apply"',
    ])
  })

  it('takes classes and variants with the theme prefix, as Tailwind does', async () => {
    const prefixed = await defineConfig({
      root: project.dir,
      tailwindcss: { entryPoint: 'prefixed/global.css', validateApply: true },
    })
    expect(
      await reportsOf(
        '.a {\n  @apply tw:flex tw:hover:underline flex;\n\n  @variant hover {\n    color: red;\n  }\n}\n',
        prefixed,
      ),
    ).toEqual(['Unexpected unknown utility class "flex" in "@apply"'])
  })

  it("uses Tailwind's default design system without an entry point", async () => {
    const defaults = await defineConfig({
      root: project.dir,
      tailwindcss: { validateApply: true },
    })
    expect(await reportsOf('.a {\n  @apply flex btn;\n}\n', defaults)).toEqual([
      'Unexpected unknown utility class "btn" in "@apply"',
    ])
  })

  it('reloads the design system after a stylesheet it read changes', async () => {
    const components = path.join(project.dir, 'src/components.css')
    const before = await fs.readFile(components, 'utf8')
    try {
      await fs.writeFile(components, `${before}\n@utility card-2 {\n  padding: 2rem;\n}\n`)
      const changed = await defineConfig({
        root: project.dir,
        tailwindcss: { entryPoint: 'src/global.css', validateApply: true },
      })
      expect(await reportsOf('.a {\n  @apply card-2;\n}\n', changed)).toEqual([])
      expect(await reportsOf('.a {\n  @apply card-2;\n}\n', config)).toEqual([
        'Unexpected unknown utility class "card-2" in "@apply"',
      ])
    } finally {
      await fs.writeFile(components, before)
    }
  })

  it.each([
    ['without one', true],
    ['with another', { entryPoint: 'prefixed/global.css', validateApply: true }],
  ])(
    'checks with your design system under an extended defineConfig-built config %s',
    async (_name, tailwindcss) => {
      const extending = await defineConfig({
        root: project.dir,
        extends: [await defineConfig({ root: project.dir, tailwindcss })],
        tailwindcss: { entryPoint: 'src/global.css', validateApply: true },
      })
      expect(await reportsOf('.a {\n  @apply flex tab-4 nope;\n}\n', extending)).toEqual([
        'Unexpected unknown utility class "nope" in "@apply"',
      ])
    },
  )

  it('checks with the design system of an extended defineConfig-built config', async () => {
    const extending = await defineConfig({
      root: project.dir,
      extends: [
        await defineConfig({
          root: project.dir,
          tailwindcss: { entryPoint: 'src/global.css', validateApply: true },
        }),
      ],
      tailwindcss: true,
    })
    expect(await reportsOf('.a {\n  @apply flex tab-4 nope;\n}\n', extending)).toEqual([
      'Unexpected unknown utility class "nope" in "@apply"',
    ])
    // Off in Markdown, as without the extends
    expect(await reportsOf('```css\n.a {\n  @apply nope;\n}\n```\n', extending, 'a.md')).toEqual([])
  })

  it('loads an entry point whose @utility and @custom-variant bodies fail to compile, and reports them', async () => {
    const entryPoint = path.join(project.dir, 'utility-error/global.css')
    const loaded = await defineConfig({
      root: project.dir,
      tailwindcss: { entryPoint, validateApply: true },
    })
    expect(
      await reportsOf(await fs.readFile(entryPoint, 'utf8'), loaded, '../utility-error/global.css'),
    ).toEqual([
      'Unexpected unknown utility class "nope" in "@apply"',
      'Unexpected unknown variant "nope-variant" in "@variant"',
      'Unexpected unknown utility class "also-nope" in "@apply"',
    ])
    expect(
      await reportsOf('.a {\n  @apply bad bad-theme bad-variant:flex nope;\n}\n', loaded),
    ).toEqual(['Unexpected unknown utility class "nope" in "@apply"'])
  })

  it('throws when Tailwind fails to compile the entry point, with the error as the cause', async () => {
    const error: unknown = await defineConfig({
      root: project.dir,
      tailwindcss: { entryPoint: 'broken/global.css', validateApply: true },
    }).catch((error_: unknown) => error_)
    expect(error).toBeInstanceOf(TypeError)
    expect((error as TypeError).message).toMatch(
      /^@gpahal\/stylelint-config: `tailwindcss\.validateApply`: compiling `[^`]+global\.css` with Tailwind CSS failed: /,
    )
    expect((error as TypeError).cause).toBeInstanceOf(Error)
  })
})
