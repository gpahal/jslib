import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { format, getSupportInfo, resolveConfig, type Config } from 'prettier'

import {
  assertBuildIsCurrent,
  runNode,
  runNodeOk,
  withTmpProject,
  writeFiles,
} from '@gpahal/internal/node/testing'

import defaultConfig, { defineConfig, mergeConfigs } from '@/index'

const ROOT = path.resolve(import.meta.dirname, '..')

const baseConfig = defineConfig({ root: ROOT })

/**
 * A Tailwind CSS entry file whose theme adds a `brand` color
 */
const STYLESHEET = path.join(import.meta.dirname, 'fixtures/tailwind.css')

/**
 * A source whose imports the import sorter reorders, and the order it gives
 */
const UNSORTED_IMPORTS =
  "import z from 'zod'\nimport path from 'node:path'\n\nexport const values = [z, path]\n"
const SORTED_IMPORTS =
  "import path from 'node:path'\n\nimport z from 'zod'\n\nexport const values = [z, path]\n"

/**
 * A `package.json` whose keys prettier-plugin-packagejson reorders, and the order it gives
 */
const UNSORTED_PACKAGE_JSON = '{ "version": "1.0.0", "name": "a" }\n'
const SORTED_PACKAGE_JSON = '{\n  "name": "a",\n  "version": "1.0.0"\n}\n'

const ASTRO_PLUGIN = fileURLToPath(import.meta.resolve('prettier-plugin-astro'))

/**
 * A plugin whose `rooted` parser prints every file as `from root`
 */
const ROOTED_PLUGIN = `export const parsers = {
  rooted: { parse: () => ({}), astFormat: 'rooted', locStart: () => 0, locEnd: () => 0 },
}
export const printers = { rooted: { print: () => 'from root' } }
`

/**
 * Formats like a project whose Prettier config file exports `config`: `overrides` apply only
 * through a config file. Every plugin the preset adds is a path, which JSON can hold
 */
async function formatWith(config: Config, filename: string, source: string) {
  await using project = await withTmpProject('prettier-config', {
    '.prettierrc.json': JSON.stringify(config),
  })
  const filepath = path.join(project.dir, filename)
  const options = await resolveConfig(filepath, {
    config: path.join(project.dir, '.prettierrc.json'),
  })
  return await format(source, { ...options, filepath })
}

/**
 * `count` space-separated words, for prose of a given length
 */
function words(count: number) {
  return Array.from({ length: count }, () => 'word').join(' ')
}

describe('base config', () => {
  it('formats and sorts imports into groups', async () => {
    const source = `import { b } from './b';
import x from "@/components/x";
import z from "zod";
import React from "react";
import { a } from "@gpahal/std";
import path from "node:path";
import { c } from "@/lib/c";
import { v } from "@/convex/v";
import { d } from "@convex/d";
import { t } from "~/t";
import { h } from "#internal/h";

export const values = [path, React, x, z, a, b, c, v, d, t, h];
`
    // An app-specific alias, such as `@/convex`, goes with the other `@/` imports
    expect(await formatWith(baseConfig, 'index.ts', source)).toBe(`import path from 'node:path'

import React from 'react'

import { d } from '@convex/d'
import z from 'zod'

import { a } from '@gpahal/std'

import { c } from '@/lib/c'
import x from '@/components/x'
import { v } from '@/convex/v'
import { t } from '~/t'
import { h } from '#internal/h'

import { b } from './b'

export const values = [path, React, x, z, a, b, c, v, d, t, h]
`)
  })

  it('merges type and value imports from one module, and sorts files with decorators', async () => {
    const source = `import { b } from 'z'
import type { A } from 'z'
import { customElement } from 'lit/decorators.js'
import path from 'node:path'

@customElement('x-a')
export class A extends HTMLElement {
  accessor value = path.sep
}
export const c: A | typeof b = b
`
    expect(await formatWith(baseConfig, 'index.ts', source)).toBe(`import path from 'node:path'

import { customElement } from 'lit/decorators.js'
import { b, type A } from 'z'

@customElement('x-a')
export class A extends HTMLElement {
  accessor value = path.sep
}
export const c: A | typeof b = b
`)
  })

  // JSX would make the sorter read `<string>z` as an element and abort
  it('sorts imports in .mts and .cts files with angle-bracket type assertions', async () => {
    const source =
      "import z from 'zod'\nimport path from 'node:path'\n\nexport const a = <string>z\n"
    for (const filename of ['g.mts', 'g.cts']) {
      expect(await formatWith(baseConfig, filename, source)).toBe(
        "import path from 'node:path'\n\nimport z from 'zod'\n\nexport const a = <string>z\n",
      )
    }
  })

  it('sorts scheme imports with the built-ins, and react-dom and react-native with react', async () => {
    const source = [
      "import z from 'zod'",
      "import { as } from 'astro:content'",
      "import { createRoot } from 'react-dom/client'",
      "import { View } from 'react-native'",
      "import React from 'react'",
      "import { env } from 'cloudflare:workers'",
      "import path from 'node:path'",
      "import { test } from 'bun:test'",
      "import { flushSync } from 'react-dom'",
      '',
      'export const v = [z, as, createRoot, View, React, env, path, test, flushSync]',
      '',
    ].join('\n')
    expect(await formatWith(baseConfig, 'a.ts', source)).toBe(
      [
        "import path from 'node:path'",
        "import { test } from 'bun:test'",
        "import { env } from 'cloudflare:workers'",
        '',
        "import React from 'react'",
        "import { flushSync } from 'react-dom'",
        "import { createRoot } from 'react-dom/client'",
        "import { View } from 'react-native'",
        "import { as } from 'astro:content'",
        '',
        "import z from 'zod'",
        '',
        'export const v = [z, as, createRoot, View, React, env, path, test, flushSync]',
        '',
      ].join('\n'),
    )
  })

  // A directive applies to the line below it, so its import stays where it is, as a barrier
  it.each(['// @ts-expect-error -- no types', '/* @ts-ignore */'])(
    'keeps an import under %s in place',
    async (directive) => {
      for (const before of [[], ["import path from 'node:path'", "import z from 'zod'"]]) {
        const source = [
          ...before,
          directive,
          "import untyped from 'untyped'",
          "import a from 'a'",
          "import fs from 'node:fs'",
          '',
          'export const v = [untyped, a, fs]',
          '',
        ].join('\n')
        const formatted = await formatWith(baseConfig, 'a.ts', source)
        expect(formatted).toContain(
          [
            ...(before.length === 0 ? [] : ["import z from 'zod'", '']),
            directive,
            "import untyped from 'untyped'",
            '',
            "import fs from 'node:fs'",
            '',
            "import a from 'a'",
          ].join('\n'),
        )
        expect(formatted).not.toContain('@gpahal/prettier-config')
        expect(await formatWith(baseConfig, 'a.ts', formatted)).toBe(formatted)
      }
    },
  )

  // The README's example for CSS imports
  it('sorts the bare imports that importOrderSafeSideEffects lists', async () => {
    const source = [
      "import { b } from './b'",
      "import './styles.css'",
      "import { a } from './a'",
      "import './setup'",
      "import z from 'zod'",
      '',
      'export const v = [a, b, z]',
      '',
    ].join('\n')
    const config = defineConfig({
      root: ROOT,
      sortImports: { importOrderSafeSideEffects: [String.raw`\.css$`] },
    })
    expect(await formatWith(config, 'a.ts', source)).toBe(
      [
        "import { a } from './a'",
        "import { b } from './b'",
        "import './styles.css'",
        '',
        "import './setup'",
        '',
        "import z from 'zod'",
        '',
        'export const v = [a, b, z]',
        '',
      ].join('\n'),
    )
  })

  // Upstream canary for the README's known issue about trailing comments on imports, from
  // @ianvs/prettier-plugin-sort-imports. When this passes, remove that known issue.
  // Correct: imports of one group have no blank line between them, as without the trailing comment
  it.fails('known bug: adds a blank line after an import with a trailing comment', async () => {
    const source = [
      "import { z } from 'zod' // trailing",
      '// leading',
      "import path from 'node:path'",
      "import * as ns from 'zod'",
      '',
      'export const v = [z, path, ns]',
      '',
    ].join('\n')
    expect(await formatWith(baseConfig, 'a.ts', source)).toContain(
      "import { z } from 'zod' // trailing\nimport * as ns from 'zod'\n",
    )
  })

  // Prettier's own parser formats a `.vue` file, since the sorter's `vue` parser needs
  // `@vue/compiler-sfc`, which a project without Vue lacks
  it('formats a .vue file without @vue/compiler-sfc', async () => {
    expect(() => createRequire(import.meta.url).resolve('@vue/compiler-sfc')).toThrow(
      /Cannot find module/,
    )
    using error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    using warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const source =
      '<script setup lang="ts">\nimport z from "zod"\nimport path from "node:path"\n</script>\n\n<template><div>{{ z }}{{ path }}</div></template>\n'
    for (const config of [baseConfig, defineConfig({ root: ROOT, tailwindcss: true })]) {
      expect(await formatWith(config, 'a.vue', source)).toBe(
        "<script setup lang=\"ts\">\nimport z from 'zod'\nimport path from 'node:path'\n</script>\n\n<template>\n  <div>{{ z }}{{ path }}</div>\n</template>\n",
      )
      expect(await formatWith(config, 'a.md', `\`\`\`vue\n${source}\`\`\`\n`)).toContain('```vue\n')
    }
    expect(error).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })

  // Tools write these in a style Prettier would rewrite, and rewrite them back on their next run.
  // ESLint writes its suppressions file without a final newline
  it('leaves generated files as tools write them', async () => {
    const config = defaultConfig
    const source = '/* eslint-disable */\n// This file was generated.\nexport const a = "b";\n'
    const suppressions = JSON.stringify({ 'src/a.ts': { 'no-console': { count: 1 } } }, null, 2)
    const lockfile = 'packages:\n\n  prettier@3.9.10:\n    resolution: {integrity: sha512-AAAA==}\n'
    for (const [file, text] of [
      ['pnpm-lock.yaml', lockfile],
      ['apps/web/next-env.d.ts', source],
      ['src/routeTree.gen.ts', source],
      ['apps/backend/convex/_generated/server.d.ts', source],
      ['worker-configuration.d.ts', source],
      ['apps/web/eslint-suppressions.json', suppressions],
    ]) {
      expect(await formatWith(config, file!, text!)).toBe(text)
    }
    expect(await formatWith(config, 'convex/api.ts', source)).not.toBe(source)
  })

  // Prettier's MDX parser reads MDX 1, and its output can render differently in MDX 2 and 3
  it('leaves an .mdx file without a pragma as it is', async () => {
    const config = defaultConfig
    const mdx = "import Note from './note.astro'\n\n*Emphasis*\n\n<Note>\n**bold**\n</Note>\n"
    expect(await formatWith(config, 'docs/a.mdx', mdx)).toBe(mdx)
    // `{/* @format */}`, since MDX 2 and 3 reject HTML comments
    expect(await formatWith(config, 'a.mdx', `{/* @format */}\n\n${mdx}`)).toContain('_Emphasis_')
  })

  it('keeps each paragraph on one line', async () => {
    const paragraph = 'A paragraph that keeps going. '.repeat(5).trim()
    const markdown = `# Title\n\n${paragraph}\n`
    const wrapped = `# Title\n\n${paragraph.replaceAll('. ', '.\n')}\n`
    expect(await formatWith(baseConfig, 'README.md', markdown)).toBe(markdown)
    expect(await formatWith(baseConfig, 'README.md', wrapped)).toBe(markdown)
    // Every file Prettier parses as Markdown, by extension or by filename
    for (const filename of ['README.markdown', 'a.mdown', 'README', 'contents.lr']) {
      expect(await formatWith(baseConfig, filename, wrapped)).toBe(markdown)
    }
  })

  // The plugin wraps Prettier's Markdown printer, so a Prettier upgrade could change its output
  it.each(['never', 'always'] as const)(
    'keeps GitHub alert markers in nested blockquotes, lists and CRLF files with proseWrap: %s',
    async (proseWrap) => {
      const config = defineConfig({ root: ROOT, markdown: { proseWrap, printWidth: 40 } })
      const source = [
        '> [!NOTE]',
        `> ${words(12)}.`,
        '>',
        '> - A list item',
        '> - [!TIP] Not a marker.',
        '>',
        '> > [!WARNING]',
        '> > Nested alert text.',
        '',
        '- Item',
        '',
        '  > [!CAUTION]',
        '  > Alert in a list.',
        '',
      ].join('\r\n')
      const formatted = await formatWith(config, 'README.md', source)
      expect(formatted).toMatchSnapshot()
      for (const marker of ['> [!NOTE]\n', '> > [!WARNING]\n', '  > [!CAUTION]\n']) {
        expect(formatted).toContain(marker)
      }
      expect(await formatWith(config, 'README.md', formatted)).toBe(formatted)
    },
  )

  it('adds no trailing commas to the files Prettier parses as JSON with comments', async () => {
    const source = '{\n  // A comment\n  "a": {\n    "b": 1\n  }\n}\n'
    for (const filename of [
      'a.jsonc',
      'a.code-workspace',
      'a.sublime-settings',
      'x.sublime_session',
    ]) {
      expect(await formatWith(baseConfig, filename, source)).toBe(source)
    }
  })

  // The overrides list the files by hand, so a Prettier upgrade that changes a language fails here.
  // The patterns name only that language's files, so the JSON override sets no option for another
  // language, such as YAML's `.sublime-syntax`
  it.each([
    ['jsonc', { trailingComma: 'none' }],
    ['markdown', { proseWrap: 'never' }],
  ] as const)("matches the files of Prettier's %s language", async (parser, options) => {
    const { languages } = await getSupportInfo()
    const patterns = languages.flatMap((language) =>
      language.parsers.includes(parser)
        ? [
            ...(language.extensions ?? []).map((extension) => `*${extension}`),
            ...(language.filenames ?? []),
          ]
        : [],
    )
    const override = baseConfig.overrides?.find((candidate) =>
      Object.entries(options).every(([key, value]) => candidate.options?.[key] === value),
    )
    expect(new Set([override?.files ?? []].flat())).toEqual(new Set(patterns))
  })

  // Editors resolve the config with `.editorconfig`, which the preset's settings win over
  it('wins over .editorconfig', async () => {
    await using project = await withTmpProject('prettier-config-editorconfig', {
      '.prettierrc.json': JSON.stringify(baseConfig),
      '.editorconfig':
        'root = true\n\n[*]\nindent_style = tab\nindent_size = 4\nend_of_line = crlf\nmax_line_length = 40\n',
    })
    const filepath = path.join(project.dir, 'a.ts')
    const options = await resolveConfig(filepath, { editorconfig: true })
    const source = 'export const a = { key: "value", other: [1, 2, 3], more: true };\n'
    expect(await format(source, { ...options, filepath })).toBe(
      "export const a = { key: 'value', other: [1, 2, 3], more: true }\n",
    )
  })
})

/**
 * Modules whose run order decides what `main.mjs` sees: `z-init.mjs` sets a global that `a-read.mjs`
 * reads when it runs
 */
const ORDER_MODULES = {
  'z-init.mjs': 'globalThis.initialized = true\nexport const initialized = true\n',
  'a-read.mjs': 'export const observed = globalThis.initialized === true\n',
}

const ORDER_MAIN = `import { initialized } from './z-init.mjs'
import { observed } from './a-read.mjs'
globalThis.result = [initialized, observed]
`

/**
 * The `globalThis.result` that `main` sets when Node runs it in its own process
 */
async function runMain(main: string) {
  await using project = await withTmpProject('prettier-config-order', {
    ...ORDER_MODULES,
    'main.mjs': main,
  })
  const script = `await import(${JSON.stringify(pathToFileURL(path.join(project.dir, 'main.mjs')).href)})
console.log(JSON.stringify(globalThis.result))`
  await using emptyProject = await withTmpProject('prettier-config-no-root')
  const stdout = await runNodeOk(['--input-type=module', '--eval', script], {
    cwd: emptyProject.dir,
  })
  return JSON.parse(stdout) as unknown
}

describe('import sorting at run time', () => {
  it('changes the order modules run in', async () => {
    expect(await runMain(ORDER_MAIN)).toEqual([true, true])
    expect(await runMain(await formatWith(baseConfig, 'main.mjs', ORDER_MAIN))).toEqual([
      true,
      false,
    ])
  })

  // The README's escapes. Each adds only a line to `ORDER_MAIN`, whose order before formatting the
  // test above runs
  it.each([
    ['a bare import', `import './z-init.mjs'\n${ORDER_MAIN}`],
    ['// prettier-ignore', `// prettier-ignore\n${ORDER_MAIN}`],
  ])('keeps the order with %s', async (_, main) => {
    expect(await runMain(await formatWith(baseConfig, 'main.mjs', main))).toEqual([true, true])
  })
})

describe('tailwindcss config', () => {
  // The Tailwind plugin resolves a relative entry point from the config file that Prettier's search
  // finds from the formatted file, or else from the working folder, not from a config file given by
  // path, as with `--config` or an editor's setting. The README recommends `root` there
  it("resolves a relative entry point from root when Prettier is given the config file's path", async () => {
    await using project = await withTmpProject('prettier-config-tailwind', {
      'styles/tailwind.css': await fs.readFile(STYLESHEET, 'utf8'),
    })
    const configDir = path.join(project.dir, 'config')
    await fs.mkdir(configDir)
    const tailwindcss = { entryPoint: '../styles/tailwind.css' }
    await writeFiles(configDir, {
      'unrooted.json': JSON.stringify(defineConfig({ tailwindcss })),
      'rooted.json': JSON.stringify(defineConfig({ root: configDir, tailwindcss })),
    })
    const filepath = path.join(project.dir, 'src/a.tsx')
    const formatWithConfig = async (name: string) => {
      const options = await resolveConfig(filepath, { config: path.join(configDir, name) })
      return format('export const a = cn("text-brand p-4")', { ...options, filepath })
    }
    expect(process.cwd()).not.toBe(project.dir)
    await expect(formatWithConfig('unrooted.json')).rejects.toThrow(/ENOENT/)
    // `text-brand` sorts as a text color only with the stylesheet's theme
    expect(await formatWithConfig('rooted.json')).toBe("export const a = cn('p-4 text-brand')\n")
  })

  // The Tailwind plugin composes the import sorter only when its path in `plugins` is the one the
  // Tailwind plugin resolves, and otherwise leaves imports unsorted without an error
  it('sorts imports, and classes in class attributes and class-name helpers', async () => {
    const config = defineConfig({ root: ROOT, tailwindcss: { entryPoint: STYLESHEET } })
    const source = [
      "import z from 'zod'",
      "import path from 'node:path'",
      '',
      'export const values = [z, path]',
      'export const A = () => <div className="p-4 flex text-sm" />',
      "export const b = cn('p-4 flex', { 'mt-2 block': true })",
      "export const c = 'p-4 flex'",
      "export const e = twMerge('text-brand p-4', 'p-4 flex')",
      '',
    ].join('\n')
    // Variables are left to ESLint's class order rule. `text-brand` sorts as a text color, from the
    // stylesheet's theme
    expect(await formatWith(config, 'a.tsx', source)).toBe(
      [
        "import path from 'node:path'",
        '',
        "import z from 'zod'",
        '',
        'export const values = [z, path]',
        'export const A = () => <div className="flex p-4 text-sm" />',
        "export const b = cn('flex p-4', { 'mt-2 block': true })",
        "export const c = 'p-4 flex'",
        "export const e = twMerge('p-4 text-brand', 'flex p-4')",
        '',
      ].join('\n'),
    )
  })

  // prettier-plugin-merge fails with the import sorter on; see the canary in upstream.test.ts
  it('sorts and then wraps classes with prettier-plugin-classnames and prettier-plugin-merge', async () => {
    const require = createRequire(import.meta.url)
    const config = defineConfig({
      root: ROOT,
      tailwindcss: { entryPoint: STYLESHEET },
      sortImports: false,
      options: {
        plugins: [
          require.resolve('prettier-plugin-classnames'),
          require.resolve('prettier-plugin-merge'),
        ],
      },
    })
    const classes =
      'p-4 flex text-sm mt-2 mb-2 ml-2 mr-2 bg-red-500 text-white rounded-xl border border-zinc-400/30 dark:border-neutral-500/30 hover:bg-red-600'
    expect(
      await formatWith(config, 'a.tsx', `export const A = () => <div className="${classes}" />\n`),
    ).toBe(
      [
        'export const A = () => (',
        '  <div',
        '    className="mt-2 mr-2 mb-2 ml-2 flex rounded-xl border border-zinc-400/30 bg-red-500 p-4 text-sm',
        '      text-white hover:bg-red-600 dark:border-neutral-500/30"',
        '  />',
        ')',
        '',
      ].join('\n'),
    )
  })
})

describe('options', () => {
  // The wrapper leaves out the sorter's parsers whose plugins aren't installed, which
  // prettier-plugin-merge would fail on
  it('sorts imports with prettier-plugin-classnames and then prettier-plugin-merge', async () => {
    const require = createRequire(import.meta.url)
    const config = defineConfig({
      root: ROOT,
      options: {
        plugins: [
          require.resolve('prettier-plugin-classnames'),
          require.resolve('prettier-plugin-merge'),
        ],
      },
    })
    expect(await formatWith(config, 'a.ts', UNSORTED_IMPORTS)).toBe(SORTED_IMPORTS)
  })

  // As in a monorepo whose app installs a plugin that Prettier, run from the repo root, can't find
  it('resolves bare plugin names from root when the config is elsewhere', async () => {
    await using project = await withTmpProject('prettier-config-plugin-name-root', {
      'package.json': '{}',
      // ESM-only, so only an `import` resolution finds it
      'node_modules/prettier-plugin-rooted/package.json': JSON.stringify({
        name: 'prettier-plugin-rooted',
        type: 'module',
        exports: { import: './index.js' },
      }),
      'node_modules/prettier-plugin-rooted/index.js': ROOTED_PLUGIN,
    })
    const config = defineConfig({
      root: project.dir,
      sortImports: false,
      githubAlerts: false,
      packageJson: false,
      options: { plugins: ['prettier-plugin-rooted'], parser: 'rooted' },
    })
    expect(await formatWith(config, 'a.rooted', 'source')).toBe('from root')
  })

  it("keeps the inherited plugins in a merged override's files when it adds plugins", async () => {
    const config = mergeConfigs(defineConfig({ root: ROOT }), {
      overrides: [{ files: 'special/**', options: { plugins: [ASTRO_PLUGIN] } }],
    })
    expect(await formatWith(config, 'special/a.ts', UNSORTED_IMPORTS)).toBe(SORTED_IMPORTS)
    expect(await formatWith(config, 'special/package.json', UNSORTED_PACKAGE_JSON)).toBe(
      SORTED_PACKAGE_JSON,
    )
  })

  // The README's way to keep imports where they are in some files
  it("turns sorting off in an override's files with an empty importOrder", async () => {
    const config = defineConfig({
      root: ROOT,
      overrides: [{ files: 'legacy/**', options: { importOrder: [] } }],
    })
    expect(await formatWith(config, 'legacy/a.ts', UNSORTED_IMPORTS)).toBe(UNSORTED_IMPORTS)
    expect(await formatWith(config, 'a.ts', UNSORTED_IMPORTS)).toBe(SORTED_IMPORTS)
  })
})

describe('astro config', () => {
  it('formats .astro files and sorts frontmatter imports', async () => {
    const config = defineConfig({
      root: ROOT,
      astro: true,
      tailwindcss: { entryPoint: STYLESHEET },
    })
    const source = [
      '---',
      'import b from "./b";',
      'import { getCollection } from "astro:content";',
      '---',
      '<div class="p-4 flex">{b}</div>',
      '',
    ].join('\n')
    // prettier-plugin-tailwindcss doesn't sort classes in .astro files: it doesn't support the AST
    // of prettier-plugin-astro 1.x
    expect(await formatWith(config, 'page.astro', source)).toBe(
      [
        '---',
        "import { getCollection } from 'astro:content'",
        '',
        "import b from './b'",
        '---',
        '',
        '<div class="p-4 flex">{b}</div>',
        '',
      ].join('\n'),
    )
  })

  it('keeps shorthand attributes in the form they are written', async () => {
    const config = defineConfig({ root: ROOT, astro: true })
    const source = '---\nconst title = 1\n---\n\n<a {title} />\n<a title={title} />\n'
    expect(await formatWith(config, 'page.astro', source)).toBe(source)
  })
})

describe('prettier CLI', () => {
  const BUILD_DIR = path.join(import.meta.dirname, '..', 'build')
  beforeAll(async () => {
    await assertBuildIsCurrent(BUILD_DIR)
  })
  const buildUrl = (file: string) => pathToFileURL(path.join(BUILD_DIR, file)).href
  const CONFIG = `import { defineConfig } from '${buildUrl('index.js')}'

export default defineConfig({ root: ${JSON.stringify(ROOT)}, astro: true, tailwindcss: { entryPoint: 'tests/fixtures/tailwind.css' } })
`
  const PRETTIER_BIN = path.join(
    path.dirname(createRequire(import.meta.url).resolve('prettier/package.json')),
    'bin/prettier.cjs',
  )

  // Each module is loaded only when needed: Prettier's Markdown plugin, which is large, once
  // Prettier imports the GitHub alerts plugin by its path; Zod once `defineConfig` checks options;
  // and the import sorter, which loads Babel and costs over 100 ms, only to check a `sortImports` key
  // it may have added
  it('loads the Markdown plugin, Zod and the import sorter only when needed', async () => {
    const script = `import { registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'

const urls = []
registerHooks({
  resolve(specifier, context, nextResolve) {
    const result = nextResolve(specifier, context)
    urls.push(result.url)
    return result
  },
})
const isLoaded = (part) => urls.some((url) => url.includes(part))
const loaded = () => ['/prettier/plugins/markdown', '/node_modules/zod/', '/prettier-plugin-sort-imports/'].map(isLoaded)
const steps = []
const { default: config, defineConfig } = await import(${JSON.stringify(buildUrl('index.js'))})
steps.push(loaded())
const alerts = config.plugins.find((plugin) => String(plugin).endsWith('github-alerts.js'))
await import(pathToFileURL(alerts).href)
steps.push(loaded())
defineConfig({ sortImports: { importOrderCaseSensitive: true, importOrderSafeSideEffects: [] } })
steps.push(loaded())
try {
  defineConfig({ sortImports: { importOrderFoo: true } })
} catch {}
steps.push(loaded())
console.log(JSON.stringify(steps))
`
    const stdout = await runNodeOk(['--input-type=module', '--eval', script])
    expect(JSON.parse(stdout)).toEqual([
      [false, false, false],
      [true, false, false],
      [true, true, false],
      [true, true, true],
    ])
  })

  // Prettier resolves a plugin named by package from the working directory, not the config file
  it('loads the plugins from a working directory that cannot resolve them', async () => {
    await using tmpProject = await withTmpProject('prettier-config-cli', {
      'project/prettier.config.mjs': CONFIG,
    })
    const projectDir = path.join(tmpProject.dir, 'project')
    const cwd = path.join(tmpProject.dir, 'cwd')
    await fs.mkdir(cwd)
    await writeFiles(projectDir, {
      'package.json': '{ "version": "1.0.0", "name": "a" }\n',
      'a.md': '> [!NOTE]\n> Some\n> text.\n',
      'a.tsx':
        'import b from "./b";\nimport React from "react";\n\nexport const A = () => <div className="p-4 flex">{React.version}{b}</div>;\n',
    })
    // Prettier prints each file it formats in turn
    const files = ['package.json', 'a.md', 'a.tsx'].map((file) => path.join(projectDir, file))
    expect(await runNodeOk([PRETTIER_BIN, ...files], { cwd })).toBe(
      [
        '{\n  "name": "a",\n  "version": "1.0.0"\n}',
        // The GitHub alerts plugin is in the config as the path of a module in the build
        '> [!NOTE]\n> Some text.',
        "import React from 'react'",
        '',
        "import b from './b'",
        '',
        'export const A = () => (',
        '  <div className="flex p-4">',
        '    {React.version}',
        '    {b}',
        '  </div>',
        ')',
        '',
      ].join('\n'),
    )
  })

  // The README's CommonJS form, where `require` gives the module namespace, and the static config
  it.each([
    [
      'prettier.config.cjs',
      "const { defineConfig } = require('@gpahal/prettier-config')\n\nmodule.exports = defineConfig({})\n",
    ],
    ['package.json', JSON.stringify({ name: 'consumer', prettier: '@gpahal/prettier-config' })],
  ])('formats with the package installed and a %s', async (file, config) => {
    await using project = await withTmpProject('prettier-config-cjs', {
      'package.json': JSON.stringify({ name: 'consumer', type: 'commonjs' }),
      [file]: config,
      'a.ts': UNSORTED_IMPORTS,
    })
    const scopeDir = path.join(project.dir, 'node_modules/@gpahal')
    await fs.mkdir(scopeDir, { recursive: true })
    await fs.symlink(path.join(import.meta.dirname, '..'), path.join(scopeDir, 'prettier-config'))
    const { status, stdout, stderr } = await runNode(
      [PRETTIER_BIN, path.join(project.dir, 'a.ts')],
      { cwd: project.dir },
    )
    expect(stderr).toBe('')
    expect(status).toBe(0)
    expect(stdout).toBe(SORTED_IMPORTS)
  })
})
