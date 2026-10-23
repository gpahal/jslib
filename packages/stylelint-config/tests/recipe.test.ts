import path from 'node:path'
import process from 'node:process'

import * as prettier from 'prettier'
import stylelint from 'stylelint'

import { withTmpProject } from '@gpahal/internal/node/testing'

import { defineConfig } from '@/index'

import { fix, lintRules } from './helpers'
import { TAILWIND_CSS } from './tailwind-fixture'

// The order the repository README recommends: Prettier, then `stylelint --fix`. One run of each
// settles the files, so running both again changes nothing

/**
 * CSS with a media query range for `media-feature-range-notation` and `@gpahal/media-range-spacing`
 * to fix, a rule after it, a string in double quotes, a comment for `@gpahal/comment-layout` and a
 * two-value `display` for `display-notation`
 */
const CSS = [
  '@media (max-width:100px) { a { color: red; } }',
  'b { content: "x"; }',
  '/* One',
  '   two. */',
  'em { display: inline flow; color: blue; }',
  '',
].join('\n')

const FIXTURES: Record<string, string> = {
  'a.css': CSS,
  'README.md': `# Title\n\n\`\`\`css\n${CSS}\`\`\`\n`,
}

const PRETTIER_CONFIG_URL = import.meta.resolve('@gpahal/prettier-config')

/**
 * A project folder with `files` and a Prettier config that uses `@gpahal/prettier-config`, which
 * Prettier resolves like a project's, overrides included
 */
async function createProject(singleQuote: boolean, files: Record<string, string> = {}) {
  return withTmpProject('stylelint-config-recipe', {
    'package.json': '{}',
    ...files,
    'prettier.config.mjs': `import { defineConfig } from ${JSON.stringify(PRETTIER_CONFIG_URL)}\n\nexport default defineConfig({ root: import.meta.dirname, astro: true, options: { singleQuote: ${String(singleQuote)} } })\n`,
  })
}

async function format(dir: string, fileName: string, code: string): Promise<string> {
  const filepath = path.join(dir, fileName)
  const options = await prettier.resolveConfig(filepath)
  return prettier.format(code, { ...options, filepath })
}

const config = await defineConfig({ root: process.cwd() })

// The preset fixtures below run with `singleQuote: true`
describe('Prettier with singleQuote: false, then Stylelint, which keeps the quotes', () => {
  let project: Awaited<ReturnType<typeof createProject>>
  beforeAll(async () => {
    project = await createProject(false)
  })
  afterAll(async () => {
    await project[Symbol.asyncDispose]()
  })

  it.each(Object.keys(FIXTURES))('settles %s in one run', async (fileName) => {
    const config = await defineConfig({ root: project.dir })
    const filepath = path.join(project.dir, fileName)
    const once = await fix(
      await format(project.dir, fileName, FIXTURES[fileName] ?? ''),
      config,
      filepath,
    )
    const twice = await fix(await format(project.dir, fileName, once), config, filepath)
    expect(twice).toBe(once)

    const options = await prettier.resolveConfig(filepath)
    expect(await prettier.check(once, { ...options, filepath })).toBe(true)
    const { results } = await stylelint.lint({ code: once, codeFilename: filepath, config })
    const errors = results.flatMap((result) =>
      result.warnings
        .filter((warning) => warning.severity === 'error')
        .map((warning) => warning.text),
    )
    expect(errors).toEqual([])
  })
})

/**
 * A README whose code blocks are partial snippets: declarations without a rule, and custom
 * properties and custom media queries that no file defines
 */
const SNIPPETS_README = [
  '# Title',
  '',
  'Set the color:',
  '',
  '```css',
  'color: red;',
  '```',
  '',
  'Then the tokens:',
  '',
  '```css',
  'color: var(--brand);',
  '--brand: red;',
  '--accent: blue;',
  '```',
  '',
  '```css',
  '--brand: red;',
  '',
  '--accent: blue;',
  '```',
  '',
  '```css',
  '@media (--small) {',
  '  a {',
  '    color: var(--accent);',
  '  }',
  '}',
  '```',
  '',
].join('\n')

describe('a README with partial snippets', () => {
  let project: Awaited<ReturnType<typeof createProject>>
  beforeAll(async () => {
    project = await createProject(true, { 'tokens.css': ':root {\n  --defined: red;\n}\n' })
  })
  afterAll(async () => {
    await project[Symbol.asyncDispose]()
  })

  it('Prettier then Stylelint settle it in one run', async () => {
    const snippetsConfig = await defineConfig({ root: project.dir, referenceFiles: 'tokens.css' })
    const filepath = path.join(project.dir, 'README.md')
    const fixed = async (code: string) =>
      (
        await stylelint.lint({
          code,
          codeFilename: filepath,
          config: snippetsConfig,
          configBasedir: project.dir,
          fix: true,
        })
      ).code
    const formatted = await format(project.dir, 'README.md', SNIPPETS_README)
    const once = (await fixed(formatted)) ?? ''
    expect(once).toBe(formatted)
    expect(await fixed(await format(project.dir, 'README.md', once))).toBe(once)
  })
})

describe('Prettier, then Stylelint on preset fixtures', () => {
  let project: Awaited<ReturnType<typeof createProject>>
  beforeAll(async () => {
    project = await createProject(true)
  })
  afterAll(async () => {
    await project[Symbol.asyncDispose]()
  })

  // As the README's fixers run them: Prettier, Stylelint, then Prettier again
  async function run(code: string, preset = config) {
    const fixAndFormat = async (text: string) =>
      format(project.dir, 'a.css', await fix(await format(project.dir, 'a.css', text), preset))
    const once = await fixAndFormat(code)
    expect(await fixAndFormat(once)).toBe(once)
    return { code: once, warnings: await lintRules(once, preset) }
  }
  it('settles CSS that breaks stylelint-config-standard', async () => {
    const css = [
      ':root{--Brand-Color:#FFFFFF;}',
      'a{color:RED;display:block;font-family:Arial,sans-serif;margin:0px;width:1.1234567px}',
      '@media (max-width:1023.98px){a{color:#AABBCC}}',
      '/* One',
      '   two. */',
      'b{background:url(x.png)}',
      '',
    ].join('\n')
    const { code, warnings } = await run(css)
    expect(code).toBe(
      [
        ':root {',
        '  --Brand-Color: #fff;',
        '}',
        '',
        // Property order is reported, not fixed
        'a {',
        '  color: red;',
        '  display: block;',
        // The quote fixes add double quotes, which Prettier then makes single
        "  font-family: 'Arial', sans-serif;",
        '  margin: 0;',
        '  width: 1.1234567px;',
        '}',
        '',
        '@media (width <= 1023.98px) {',
        '  a {',
        '    color: #abc;',
        '  }',
        '}',
        '/*',
        ' * One',
        ' * two.',
        ' */',
        'b {',
        "  background: url('x.png');",
        '}',
        '',
      ].join('\n'),
    )
    expect(warnings).toEqual([
      'order/properties-order',
      'order/properties-order',
      'order/properties-order',
      'custom-property-pattern',
      'number-max-precision',
    ])
  })

  it('leaves Tailwind v4 CSS as it is', async () => {
    const { code, warnings } = await run(
      TAILWIND_CSS,
      await defineConfig({ root: process.cwd(), tailwindcss: true }),
    )
    expect(code).toBe(TAILWIND_CSS)
    expect(warnings).toEqual([])
  })
})
