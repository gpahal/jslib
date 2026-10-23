import path from 'node:path'

import type { ESLint, Linter } from 'eslint'

import { defineConfig } from '@/index'

import { createFocusedESLint } from './fix-helpers'
import {
  createESLint,
  eslintWith,
  FIXTURES_DIR,
  lint,
  lintText,
  ruleIdOf,
  ruleSeverity,
  severityOf,
  sharedESLint,
  withProject,
} from './helpers'

function globalsOf(config: Linter.Config): Linter.Globals {
  return (config.languageOptions?.['globals'] ?? {}) as Linter.Globals
}

/**
 * `html` and `astro` code blocks, which ESLint parses as JavaScript unless the `html` or `astro`
 * preset parses them
 */
const CODE_BLOCKS_MARKDOWN = [
  '# Usage',
  '',
  '```html',
  '<div class="p-4 flex"></div>',
  '```',
  '',
  '```astro',
  '---',
  'const title = process.env.TITLE',
  '---',
  '',
  '<h1 class="p-4 flex">{title}</h1>',
  '```',
  '',
].join('\n')

describe('html and astro code blocks', () => {
  it.each([
    [
      'tailwindcss',
      {
        tailwindcss: {
          entryPoint: path.join(FIXTURES_DIR, 'tailwindcss/src/styles.css'),
        },
      },
    ],
    ['turbo', { turbo: true }],
  ])(
    'are ignored by the %s preset without the html and astro presets',
    async (fixture, options) => {
      const eslint = await sharedESLint(fixture, { ...options, markdown: true, typeAware: false })
      expect(await lintText(eslint, 'README.md', CODE_BLOCKS_MARKDOWN)).toEqual([])
    },
  )
})

describe('astro preset', () => {
  it('lints .astro files at the root of root and below it', async () => {
    const eslint = await createFocusedESLint(
      'astro-untyped',
      new Set(['astro/no-conflict-set-directives']),
      { astro: true },
    )
    for (const file of ['page.astro', 'src/pages/page.astro']) {
      expect(await eslint.isPathIgnored(file), file).toBe(false)
      expect(await ruleSeverity(eslint, file, 'astro/no-conflict-set-directives'), file).toBe(2)
    }
  })

  it('lints the frontmatter with type information and <script> blocks without', async () => {
    const eslint = await sharedESLint('astro', { astro: true })
    expect(await lint(eslint, ['page.astro', 'typed.astro'])).toEqual({
      'page.astro': [expect.stringMatching(/^no-var: /), expect.stringMatching(/^prefer-const: /)],
      'typed.astro': [expect.stringMatching(/^@typescript-eslint\/no-floating-promises: /)],
    })
    expect(
      await ruleSeverity(eslint, 'typed.astro', '@typescript-eslint/no-floating-promises'),
    ).toBe(2)
    expect(
      await ruleSeverity(eslint, 'typed.astro/0_0.ts', '@typescript-eslint/no-floating-promises'),
    ).toBe(0)
  })

  it('gives type information only to the .astro files under a folder with a tsconfig.json', async () => {
    const eslint = await sharedESLint('astro-mixed', { astro: true })
    // `plain/index.astro` has no tsconfig.json to find, which would fail to parse with one
    expect(await lint(eslint, ['plain/index.astro', 'typed/typed.astro'])).toEqual({
      'plain/index.astro': [
        expect.stringMatching(/^no-var: /),
        expect.stringMatching(/^prefer-const: /),
      ],
      'typed/typed.astro': [expect.stringMatching(/^@typescript-eslint\/no-floating-promises: /)],
    })
    expect(
      await ruleSeverity(eslint, 'plain/index.astro', '@typescript-eslint/no-floating-promises'),
    ).toBe(0)
  })
})

describe('astro <script> blocks', () => {
  it('are browser code without the browser option', async () => {
    const eslint = await createFocusedESLint(
      'astro',
      (ruleId) => ruleId.startsWith('n/') || ruleId.startsWith('@gpahal/no-node-'),
      { astro: true, node: true },
    )
    const config = (await eslint.calculateConfigForFile('script.astro/0_0.ts')) as Linter.Config
    const nodeRules = Object.entries(config.rules ?? {}).filter(
      ([name, entry]) => name.startsWith('n/') && severityOf(entry) !== 0,
    )
    expect(nodeRules).toEqual([])
    expect(globalsOf(config)['window']).toBeDefined()
    expect(globalsOf(config)['process']).toBe('off')
    expect(
      await ruleSeverity(eslint, 'script.astro/0_0.ts', '@gpahal/no-node-dynamic-imports'),
    ).toBe(2)
    // The frontmatter runs on the server
    expect(await ruleSeverity(eslint, 'script.astro', '@gpahal/no-node-globals')).toBeUndefined()
  })

  it('report Node globals and built-in modules', async () => {
    const eslint = await sharedESLint('astro-untyped', { astro: true, node: true })
    const code = [
      '---',
      "const title = 'Page'",
      '---',
      '',
      '<h1>{title}</h1>',
      '',
      '<script>',
      "  const os = await import('node:os')",
      '  console.error(os, process.env.MODE)',
      '  process.exit(1)',
      "  console.error(typeof process !== 'undefined', typeof Buffer, typeof globalThis.Buffer)",
      // Bundlers replace `process.env` only in server code, so it's reported through `globalThis`
      // too, while a check of whether the code runs in Node isn't
      '  console.error(globalThis.process.env.MODE, globalThis.process !== undefined)',
      '</script>',
      '',
    ].join('\n')
    expect(await lintText(eslint, 'page.astro', code)).toEqual([
      expect.stringMatching(
        /^@gpahal\/no-node-dynamic-imports: 'node:os' is a Node built-in module\. Astro `<script>` blocks run in the browser, without Node/,
      ),
      expect.stringMatching(/^@gpahal\/no-node-globals: Unexpected use of 'process'/),
      expect.stringMatching(/^@gpahal\/no-node-globals: Unexpected use of 'process'/),
      expect.stringMatching(/^unicorn\/no-process-exit: /),
      expect.stringMatching(
        /^@gpahal\/no-node-global-properties: 'globalThis\.process' is restricted/,
      ),
    ])
  })
})

describe('react and nextjs presets', () => {
  it.each([
    ['react', { react: true }],
    ['nextjs', { nextjs: true }],
  ])('run the type-checked rules on .tsx files (%s)', async (_name, options) => {
    const eslint = await sharedESLint('react', options)
    expect(await lint(eslint, ['src/counter.tsx'])).toEqual({
      // `strict-boolean-expressions` leaves the number condition to it, as `DUPLICATE_REPORTS` lists
      'src/counter.tsx': [
        expect.stringMatching(/^@eslint-react\/no-leaked-conditional-rendering: /),
      ],
    })
  })

  it('report a component file that exports other values, unless react.refresh is false', async () => {
    const code = [
      'export function Button() {',
      '  return <button type="button" />',
      '}',
      '',
      'export function helper(): number {',
      '  return 1',
      '}',
      '',
    ].join('\n')
    const eslint = await sharedESLint('react', { react: true, typeAware: false })
    expect(await lintText(eslint, 'src/counter.tsx', code)).toEqual([
      expect.stringMatching(/^react-refresh\/only-export-components: /),
    ])
    const withoutRefresh = await sharedESLint('react', {
      react: { refresh: false },
      typeAware: false,
    })
    expect(await lintText(withoutRefresh, 'src/counter.tsx', code)).toEqual([])
  })

  it('add browser globals to all but config and CommonJS files', async () => {
    const eslint = await sharedESLint('react', { react: true, typeAware: false })
    const code = 'export const title = document.title\n'
    expect(await lintText(eslint, 'src/title.jsx', code)).toEqual([])
    expect(await lintText(eslint, 'vite.config.js', 'export default document.title\n')).toEqual([
      "no-undef: 'document' is not defined.",
    ])
    expect(await lintText(eslint, 'src/title.cjs', 'module.exports = document.title\n')).toEqual([
      "no-undef: 'document' is not defined.",
    ])
  })
})

describe('nextjs preset', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reports an <a> to a page of the pages folder under root', async () => {
    const warn = vi.spyOn(console, 'warn')
    const eslint = await createESLint('nextjs', { nextjs: true })
    expect(await lint(eslint, ['src/nav.tsx'])).toEqual({
      'src/nav.tsx': [expect.stringMatching(/^@next\/next\/no-html-link-for-pages: /)],
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it('limits the React rules to `nextjs.scope` without `react.scope`', async () => {
    const rule = '@eslint-react/dom-no-missing-button-type'
    const rules = new Set([rule])
    const eslint = await createFocusedESLint('react', rules, {
      nextjs: { scope: ['apps/web/**'] },
      typeAware: false,
    })
    expect(await ruleSeverity(eslint, 'apps/web/page.jsx', rule)).toBe(2)
    expect(await ruleSeverity(eslint, 'apps/docs/page.jsx', rule)).toBeUndefined()
    const withReactScope = await createFocusedESLint('react', rules, {
      react: { scope: ['apps/**'] },
      nextjs: { scope: ['apps/web/**'] },
      typeAware: false,
    })
    expect(await ruleSeverity(withReactScope, 'apps/docs/page.jsx', rule)).toBe(2)
    const withReact = await createFocusedESLint('react', rules, {
      react: true,
      nextjs: { scope: ['apps/web/**'] },
      typeAware: false,
    })
    expect(await ruleSeverity(withReact, 'apps/web/page.jsx', rule)).toBe(2)
    expect(await ruleSeverity(withReact, 'apps/docs/page.jsx', rule)).toBeUndefined()
    expect(await ruleSeverity(withReact, 'lib/x.tsx', rule)).toBeUndefined()
  })

  it("allows Next.js's page exports only in `nextjs`'s files", async () => {
    const eslint = await createFocusedESLint(
      'react',
      new Set(['react-refresh/only-export-components']),
      { react: { scope: ['apps/**'] }, nextjs: { scope: ['apps/web/**'] }, typeAware: false },
    )
    const code = [
      "export const metadata = { title: 'Home' }",
      '',
      'export async function getStaticProps() {',
      '  return { props: {} }',
      '}',
      '',
      'export default function Page() {',
      '  return <main />',
      '}',
      '',
    ].join('\n')
    const refreshMessages = async (file: string) =>
      (await lintText(eslint, file, code)).filter((message) => message.startsWith('react-refresh/'))
    expect(await refreshMessages('apps/web/page.jsx')).toEqual([])
    expect(await refreshMessages('apps/docs/page.jsx')).toEqual([
      expect.stringMatching(/^react-refresh\/only-export-components: /),
      expect.stringMatching(/^react-refresh\/only-export-components: /),
    ])
  })

  it('turns no-html-link-for-pages off without a pages folder', async () => {
    const warn = vi.spyOn(console, 'warn')
    const eslint = await sharedESLint('react', { nextjs: true })
    expect(await ruleSeverity(eslint, 'src/counter.tsx', '@next/next/no-html-link-for-pages')).toBe(
      0,
    )
    await lint(eslint, ['src/counter.tsx'])
    expect(warn).not.toHaveBeenCalledWith(expect.stringMatching(/Pages directory cannot be found/))
  })
})

describe('tailwindcss preset', () => {
  const tailwindcss = {
    entryPoint: path.join(FIXTURES_DIR, 'tailwindcss/src/styles.css'),
  }

  it('reports unknown classes against the entry point', async () => {
    const eslint = await sharedESLint('tailwindcss', { tailwindcss, typeAware: false })
    const messages = await lintText(
      eslint,
      'src/classes.js',
      "export const className = 'not-a-class flex'\n",
    )
    expect(messages).toEqual([
      expect.stringMatching(
        /^better-tailwindcss\/no-unknown-classes: Unknown class detected: not-a-class$/,
      ),
    ])
    expect(messages.join('\n')).not.toMatch(/entry point/)
  })

  it('reports class order, except where Prettier sorts it', async () => {
    const eslint = await sharedESLint('tailwindcss', { astro: true, tailwindcss, typeAware: false })
    const classOrder: unknown = expect.stringMatching(
      /^better-tailwindcss\/enforce-consistent-class-order: /,
    )
    expect(
      await lintText(eslint, 'src/classes.js', "export const className = 'p-2 flex'\n"),
    ).toEqual([classOrder])
    expect(await lintText(eslint, 'src/page.astro', '<div class="p-2 flex"></div>\n')).toEqual([
      classOrder,
    ])
    const jsx = [
      "const cn = (...classes) => classes.join(' ')",
      '',
      'export const a = <div className="p-2 flex" />',
      "export const b = <div className={cn('p-2 flex')} />",
      '',
    ].join('\n')
    expect(await lintText(eslint, 'src/classes.jsx', jsx)).toEqual([])
  })

  // No tailwind-merge call reads a native element's `class`, and prettier-plugin-tailwindcss
  // doesn't sort `.astro` files, so `--fix` sorts it there
  it('sorts the class order of a native element in an .astro file with --fix', async () => {
    const eslint = await createESLint(
      'tailwindcss',
      { astro: true, tailwindcss, typeAware: false },
      { fix: true },
    )
    const [result] = await eslint.lintText('<div class="p-2 flex"></div>\n', {
      filePath: path.join(FIXTURES_DIR, 'tailwindcss/src/page.astro'),
    })
    expect(result?.output).toBe('<div class="flex p-2"></div>\n')
    expect(result?.messages).toEqual([])
  })

  let whitespaceFixer: Promise<ESLint> | undefined
  it.for([
    ["'flex  p-2 '", "'flex p-2'"],
    ["'flex ' + extra", undefined],
    ["(cond ? 'flex ' : 'grid ') + extra", undefined],
    ["(extra || 'flex ') + extra", undefined],
    ["('flex ' as string) + extra", undefined],
    ["('flex ' satisfies string) + extra", undefined],
  ] as const)(
    'fixes the whitespace of `%s` only where it separates no concatenated classes',
    async ([value, fixed], { expect }) => {
      whitespaceFixer ??= createFocusedESLint(
        'tailwindcss',
        new Set(['better-tailwindcss/no-unnecessary-whitespace']),
        { tailwindcss, typeAware: false },
        { fix: true },
      )
      const eslint = await whitespaceFixer
      const header = 'declare const cond: boolean\ndeclare const extra: string\n'
      const [result] = await eslint.lintText(`${header}export const className = ${value}\n`, {
        filePath: path.join(FIXTURES_DIR, 'tailwindcss/src/classes.ts'),
      })
      expect(result?.output).toBe(
        fixed === undefined ? undefined : `${header}export const className = ${fixed}\n`,
      )
      expect(new Set(result?.messages.map((message) => message.ruleId))).toEqual(
        new Set(fixed === undefined ? ['better-tailwindcss/no-unnecessary-whitespace'] : []),
      )
    },
  )

  it('resolves a relative `entryPoint` and `cwd` setting against root, wherever ESLint runs', async () => {
    const root = path.join(FIXTURES_DIR, 'tailwindcss')
    const configs = await defineConfig({
      root,
      isInEditor: false,
      typeAware: false,
      tailwindcss: { entryPoint: 'src/styles.css', settings: { cwd: 'src' } },
    })
    const settings: unknown = configs.find((config) => config.name === 'gpahal/tailwindcss/rules')
      ?.settings?.['better-tailwindcss']
    expect(settings).toMatchObject({
      cwd: path.join(root, 'src'),
      entryPoint: path.join(root, 'src/styles.css'),
    })
    // Run from the fixtures folder, not root
    const eslint = eslintWith(FIXTURES_DIR, configs)
    expect(
      await lintText(
        eslint,
        path.join(root, 'src/classes.js'),
        "export const className = 'p-2 flex'\n",
      ),
    ).toEqual([expect.stringMatching(/^better-tailwindcss\/enforce-consistent-class-order: /)])
  })

  it('lints .html files only with the html preset', async () => {
    const eslint = await sharedESLint('html', { html: true, tailwindcss, typeAware: false })
    expect(await lint(eslint, ['index.html'])).toEqual({
      'index.html': [expect.stringMatching(/^better-tailwindcss\/no-duplicate-classes: /)],
    })
    const withoutHtml = await sharedESLint('html', { tailwindcss, typeAware: false })
    expect(await withoutHtml.isPathIgnored('index.html')).toBe(true)
  })
})

describe('html preset', () => {
  it('accepts valid HTML that Prettier formatted', async () => {
    const eslint = await sharedESLint('html', { html: true, typeAware: false })
    expect(await lint(eslint, ['index.html', 'clean.html'])).toEqual({
      'clean.html': [],
      'index.html': [],
    })
  })
})

describe('storybook preset', () => {
  const STORY = [
    "import type { Meta, StoryObj } from '@storybook/react-vite'",
    '',
    "import { Button } from './button.tsx'",
    '',
    'const meta = {',
    '  component: Button,',
    '} satisfies Meta<typeof Button>',
    '',
    'export default meta',
    '',
    'type Story = StoryObj<typeof meta>',
    '',
    "export const Primary: Story = { args: { label: 'Primary' } }",
    '',
  ].join('\n')
  const BUTTON =
    'export function Button({ label }: { label: string }) {\n  return <button type="button">{label}</button>\n}\n'
  const PACKAGE = JSON.stringify({
    private: true,
    type: 'module',
    devDependencies: { '@storybook/react-vite': '*', react: '*' },
  })

  it('passes a CSF3 story, react-refresh included, and reports a story file without stories', async () => {
    await using project = await withProject({
      'package.json': PACKAGE,
      'src/button.tsx': BUTTON,
      'src/button.stories.tsx': STORY,
    })
    const eslint = await createESLint(project.dir, {
      react: true,
      storybook: true,
      typeAware: false,
    })
    expect(await lint(eslint, ['src/button.stories.tsx'], ruleIdOf)).toEqual({
      'src/button.stories.tsx': [],
    })
    expect(
      await lintText(eslint, 'src/empty.stories.tsx', "export default { title: 'Empty' }\n"),
    ).toEqual([expect.stringMatching(/^storybook\/story-exports: /)])
    const config = (await eslint.calculateConfigForFile('src/button.stories.tsx')) as Linter.Config
    expect(severityOf(config.rules?.['storybook/hierarchy-separator'])).toBe(2)
    expect(severityOf(config.rules?.['react-hooks/rules-of-hooks'])).toBe(0)
  })
})

describe('node preset', () => {
  it('allows extensionless and path alias imports', async () => {
    const eslint = await createESLint('node', { node: true, packageJson: false })
    expect(Object.values(await lint(eslint, ['.'])).flat()).toEqual([])
  })
})

describe('test file globs that match other files', () => {
  const PROJECT = {
    'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true }, include: ['src'] }),
    'src/index.ts': 'export const a = 1\n',
    'tests/tsconfig.json': JSON.stringify({ compilerOptions: { strict: true }, include: ['.'] }),
    'tests/a.test.ts':
      "import { expect, test } from 'vitest'\n\ntest('a', () => {\n  expect(1).toBe(1)\n})\n",
    'tests/notes.md': '# Notes\n',
    'tests/fixtures/x.yaml': 'a: 1\n',
    'tests/fixtures/x.json': '{}\n',
  }

  it('lint the other files without code rules', async () => {
    await using project = await withProject(PROJECT)
    const eslint = await createESLint(project.dir, { testFiles: ['tests/**'], vitest: true })
    const results = await eslint.lintFiles(['tests'])
    expect(
      results.flatMap(({ messages }) => messages.filter(({ fatal }) => fatal === true)),
    ).toEqual([])
    expect(new Set(results.map(({ filePath }) => path.relative(project.dir, filePath)))).toEqual(
      new Set([
        'tests/a.test.ts',
        'tests/fixtures/x.json',
        'tests/fixtures/x.yaml',
        'tests/notes.md',
        'tests/tsconfig.json',
      ]),
    )
    expect(await ruleSeverity(eslint, 'tests/a.test.ts', 'vitest/unbound-method')).toBe(2)
    expect(
      await ruleSeverity(eslint, 'tests/tsconfig.json', 'vitest/unbound-method'),
    ).toBeUndefined()
  })
})

/**
 * Which runner's rules and globals `file` gets
 */
async function runnersOf(eslint: ESLint, file: string): Promise<Array<string>> {
  const config = (await eslint.calculateConfigForFile(file)) as Linter.Config
  return [
    ...(severityOf(config.rules?.['vitest/no-focused-tests']) === 2 ? ['vitest'] : []),
    ...('vi' in globalsOf(config) ? ['vi'] : []),
    ...(severityOf(config.rules?.['playwright/no-focused-test']) === 2 ? ['playwright'] : []),
  ]
}

describe('vitest and playwright files with exclusions', () => {
  it('keep the excluded files in Vitest', async () => {
    const eslint = await createFocusedESLint(
      FIXTURES_DIR,
      new Set(['vitest/no-focused-tests', 'playwright/no-focused-test']),
      {
        vitest: { files: ['{src,e2e}/**/*.test.ts'] },
        playwright: { files: ['e2e/**', '!e2e/unit/**', '!e2e/{int,perf}/**'] },
        typeAware: false,
      },
    )
    expect(await runnersOf(eslint, 'e2e/unit/a.test.ts')).toEqual(['vitest', 'vi'])
    expect(await runnersOf(eslint, 'e2e/int/a.test.ts')).toEqual(['vitest', 'vi'])
    expect(await runnersOf(eslint, 'e2e/perf/a.test.ts')).toEqual(['vitest', 'vi'])
    expect(await runnersOf(eslint, 'e2e/a.test.ts')).toEqual(['playwright'])
    expect(await runnersOf(eslint, 'src/a.test.ts')).toEqual(['vitest', 'vi'])
  })
})

describe('react preset React Compiler rules', () => {
  const compilerRules = [
    'react-hooks/config',
    'react-hooks/gating',
    'react-hooks/incompatible-library',
    'react-hooks/preserve-manual-memoization',
    'react-hooks/unsupported-syntax',
  ]

  async function severities(
    devDependencies: Record<string, string>,
    react: { compiler?: boolean } = {},
  ): Promise<Record<string, number | undefined>> {
    await using project = await withProject({
      'package.json': JSON.stringify({ name: 'a', private: true, type: 'module', devDependencies }),
    })
    const eslint = await createFocusedESLint(
      project.dir,
      new Set([...compilerRules, 'react-hooks/purity']),
      { react, typeAware: false, gitignore: false },
    )
    return Object.fromEntries(
      await Promise.all(
        [...compilerRules, 'react-hooks/purity'].map(
          async (rule) => [rule, await ruleSeverity(eslint, 'src/app.tsx', rule)] as const,
        ),
      ),
    )
  }

  const on = Object.fromEntries([...compilerRules, 'react-hooks/purity'].map((rule) => [rule, 2]))
  const off = {
    ...Object.fromEntries(compilerRules.map((rule) => [rule, 0])),
    'react-hooks/purity': 2,
  }

  it.each([
    [
      'babel-plugin-react-compiler in devDependencies',
      { 'babel-plugin-react-compiler': '1.0.0' },
      {},
      on,
    ],
    ['react-compiler-runtime in devDependencies', { 'react-compiler-runtime': '1.0.0' }, {}, on],
    ['no compiler, while the Rules of React stay on', {}, {}, off],
    [
      '`react.compiler: false` over the detection',
      { 'babel-plugin-react-compiler': '1.0.0' },
      { compiler: false },
      off,
    ],
    ['`react.compiler: true` over the detection', {}, { compiler: true }, on],
  ])('follow %s', async (_name, devDependencies, react, expected) => {
    expect(await severities(devDependencies, react)).toEqual(expected)
  })
})

describe('confusing browser globals', () => {
  const code = 'export const isTop = top === parent\nexport const height = innerHeight\n'

  /**
   * The messages of `no-restricted-globals` for `code` linted as `file`
   */
  async function restrictedGlobals(eslint: ESLint, file: string, text = code) {
    const messages = await lintText(eslint, file, text)
    expect(messages.filter((message) => message.startsWith('fatal: '))).toEqual([])
    return messages.filter((message) => message.startsWith('no-restricted-globals: '))
  }

  it.each([
    ['react', 'react', { react: true, typeAware: false }, 'src/counter.tsx'],
    [
      'browser',
      'browser',
      { browser: { files: ['src/client/**'] }, typeAware: false },
      'src/client/app.ts',
    ],
  ] as const)(
    'report a bare `top` or `innerHeight` (%s)',
    async (_name, fixture, options, file) => {
      const eslint = await sharedESLint(fixture, options)
      expect(await restrictedGlobals(eslint, file)).toEqual([
        expect.stringContaining('Use `globalThis.top`'),
        expect.stringContaining('Use `globalThis.parent`'),
        expect.stringContaining('Use `globalThis.innerHeight`'),
      ])
    },
  )

  it.each([
    ['react', 'react', { react: true, typeAware: false }, 'src/counter.tsx'],
    [
      'browser',
      'browser',
      { browser: { files: ['src/client/**'] }, typeAware: false },
      'src/client/app.ts',
    ],
  ] as const)(
    'report the ones `no-deprecated` reports, such as `name`, without type information (%s)',
    async (_name, fixture, options, file) => {
      const eslint = await sharedESLint(fixture, options)
      const text = 'export const title = name\nexport const kind = event?.type\n'
      expect(await restrictedGlobals(eslint, file, text)).toEqual([
        expect.stringContaining('Use `globalThis.name`'),
        expect.stringContaining('Use `globalThis.event`'),
      ])
    },
  )

  it('leave `name` to `no-deprecated` in files with type information', async () => {
    const eslint = await sharedESLint('browser', { browser: { files: ['src/client/**'] } })
    const text = 'export const title = name\n'
    expect(await lintText(eslint, 'src/client/app.ts', text)).toEqual([
      expect.stringMatching(/^@typescript-eslint\/no-deprecated: /),
    ])
    expect(await restrictedGlobals(eslint, 'src/client/app.js', text)).toEqual([
      expect.stringContaining('Use `globalThis.name`'),
    ])
  })
})
