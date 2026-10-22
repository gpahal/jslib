import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

import eslintPluginE18e from '@e18e/eslint-plugin'
import eslintPluginComments from '@eslint-community/eslint-plugin-eslint-comments'
import eslintPluginReact from '@eslint-react/eslint-plugin'
import markdown from '@eslint/markdown'
import { ESLint, Linter, type Rule } from 'eslint'
import eslintPluginAstro from 'eslint-plugin-astro'
import eslintPluginImportX from 'eslint-plugin-import-x'
import markdownPreferences from 'eslint-plugin-markdown-preferences'
import eslintPluginNode from 'eslint-plugin-n'
import slop from 'eslint-plugin-slop'
import eslintPluginSonarjs from 'eslint-plugin-sonarjs'
import eslintPluginUnicorn from 'eslint-plugin-unicorn'
import { pluginsToRulesDTS } from 'eslint-typegen/core'
import globals from 'globals'
import tseslint from 'typescript-eslint'

import { runNodeOk, withTmpProject, writeFiles } from '@gpahal/internal/node/testing'
import { isRecord } from '@gpahal/std/objects'

import { defineConfig } from '@/index'
import { MARKDOWN_PLUGIN } from '@/internal/markdown/plugin'
import { DEFAULT_PROJECT_CONFLICT } from '@/internal/project-service'
import { UNFLAGGED_TYPED_RULES } from '@/internal/rules'

import { collator, createESLint, lint } from './helpers'

// Each test shows an upstream bug that a workaround in this package exists for, with the stock
// plugin or language. It fails once upstream fixes the bug, and its message names the workaround
// to delete or simplify. The forks of `@eslint/markdown` rules are in `markdown-forks.test.ts`

const linter = new Linter({ configType: 'flat' })

const RULES_FIXTURE = path.join(import.meta.dirname, 'fixtures', 'rules')

function md(
  rules: Linter.RulesRecord,
  plugins: Linter.Config['plugins'] = {},
  isOwnLanguage = false,
): Linter.Config {
  return {
    files: ['**/*.md'],
    plugins: { markdown, '@gpahal/markdown': MARKDOWN_PLUGIN, ...plugins },
    language: isOwnLanguage ? '@gpahal/markdown/gfm' : 'markdown/gfm',
    rules,
  }
}

const preferences = { 'markdown-preferences': markdownPreferences }

function ts(rules: Linter.RulesRecord): Linter.Config {
  return {
    files: ['**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    plugins: { '@typescript-eslint': tseslint.plugin, 'import-x': eslintPluginImportX },
    rules,
  }
}

const typeDefinitions = ts({ '@typescript-eslint/consistent-type-definitions': ['error', 'type'] })
const inlineDuplicates: Linter.RulesRecord = {
  'import-x/no-duplicates': ['error', { 'prefer-inline': true }],
}
const astroBase = eslintPluginAstro.configs['flat/base']

/**
 * The rules reporting on `code` linted with type information, or its output with `fix`
 */
async function typedLint(
  plugins: NonNullable<Linter.Config['plugins']>,
  rules: Linter.RulesRecord,
  code: string,
  fix: boolean,
): Promise<string | Array<string> | undefined> {
  const eslint = new ESLint({
    cwd: RULES_FIXTURE,
    overrideConfigFile: true,
    overrideConfig: {
      files: ['**/*.ts'],
      languageOptions: {
        parser: tseslint.parser,
        parserOptions: { projectService: true, tsconfigRootDir: RULES_FIXTURE },
      },
      plugins,
      rules,
    },
    fix,
  })
  const [result] = await eslint.lintText(code, {
    filePath: path.join(RULES_FIXTURE, 'src/array-from-map.ts'),
  })
  return fix
    ? result?.output
    : result?.messages.map((message) => message.ruleId ?? '').toSorted(collator.compare)
}

function fileFor(config: Linter.Config | Array<Linter.Config>): string {
  if (Array.isArray(config)) {
    return 'page.astro'
  }
  const [files] = config.files ?? []
  return files === '**/*.md' ? 'doc.md' : files === '**/*.ts' ? 'x.ts' : 'x.js'
}

function rule(description: string): Rule.RuleModule {
  return { meta: { docs: { description }, schema: [{ type: 'object' }] }, create: () => ({}) }
}

describe('upstream workarounds', () => {
  // The tables name their tests by the failure message
  it.each<[string, Linter.Config, string, string]>([
    [
      // `fixDirectiveRemovals` also guards a removal's structure and range, so it stays after this
      "unused directive removal preserves Markdown now: re-check fixDirectiveRemovals in src/internal/markdown/processor/directives.ts, whose replacement of ESLint's fix may be simpler",
      {
        ...md({ 'markdown/no-html': 'error' }),
        linterOptions: { reportUnusedDisableDirectives: 'error' },
      },
      'Text <!-- eslint-disable-line markdown/no-html -->\nnext line\n',
      'Text  \nnext line\n',
    ],
    [
      'definitions-last preserves adjacent definitions now: remove it from REPORT_ONLY_RULES in src/internal/fix-policy.ts',
      md({ 'markdown-preferences/definitions-last': 'error' }, preferences),
      'Text\n\n[a]: /a\n[b]: /b\n\nMore\n',
      'Text\n[b]: /b\n\nMore\n\n[a]: /a\n',
    ],
    [
      'no-space-in-emphasis leaves `*` between numbers alone now: remove it from REPORT_ONLY_RULES in src/internal/fix-policy.ts',
      md({ 'markdown/no-space-in-emphasis': 'error' }),
      'Compute 2 * 3 * 4 here.\n',
      'Compute 2 *3* 4 here.\n',
    ],
    [
      'eslint/markdown#710 is fixed: drop the fix removal in src/internal/markdown/rules/no-bare-urls.ts, which still leaves out the URLs prefer-autolinks reports',
      md({ 'markdown/no-bare-urls': 'error' }, {}, true),
      '# T\n\nVisit www.example.com today.\n',
      '# T\n\nVisit <www.example.com> today.\n',
    ],
    [
      'prefer-autolinks checks the URL now: delete src/internal/markdown/rules/prefer-autolinks.ts and use the stock rule',
      md({ 'markdown-preferences/prefer-autolinks': 'error' }, preferences),
      '# T\n\nSee [LICENSE](LICENSE).\n',
      '# T\n\nSee <LICENSE>.\n',
    ],
    [
      'canonical-code-block-language checks source ranges now: remove its source guard in src/internal/markdown/rules/canonical-code-block-language.ts',
      md({ 'markdown-preferences/canonical-code-block-language': 'error' }, preferences),
      '```java&#115;cript\nx\n```\n',
      '```js&#115;cript\nx\n```\n',
    ],
    [
      "canonical-code-block-language measures the whole language now: forward the stock rule's location and fix in src/internal/markdown/rules/canonical-code-block-language.ts",
      md({ 'markdown-preferences/canonical-code-block-language': 'error' }, preferences),
      '# T\n\n```c++\nx\n```\n',
      '# T\n\n```cpp++\nx\n```\n',
    ],
    [
      'the two fixes no longer combine into `import type { A, type B }` (TS2206): delete the `isInlineTypeOnlyImport` check of `patchDuplicateImports` in src/internal/fixes.ts, and the patch once its other checks are gone',
      ts({ ...inlineDuplicates, '@typescript-eslint/no-import-type-side-effects': 'error' }),
      "import { type A } from 'a'\nimport type { B } from 'a'\n\nexport type C = A | B\n",
      "import type { A, type B  } from 'a'\n\nexport type C = A | B\n",
    ],
    [
      'the merge no longer writes `import B, type { A }`: delete `keepsTypeBeforeDefault` and its use in `patchDuplicateImports` in src/internal/fixes.ts, and the patch once its other checks are gone',
      ts(inlineDuplicates),
      "import type { A } from 'a'\nimport B from 'a'\n\nexport const c: A = B\n",
      "import B, type { A } from 'a'\n\nexport const c: A = B\n",
    ],
    [
      'the merge keeps the module loading now: delete `dropsSideEffectImport` and its use in `patchDuplicateImports` in src/internal/fixes.ts, and the patch once its other checks are gone',
      ts({ ...inlineDuplicates, '@typescript-eslint/no-import-type-side-effects': 'error' }),
      "import 'a'\nimport type { A } from 'a'\n\nexport type B = A\n",
      "import type { A } from 'a'\n\nexport type B = A\n",
    ],
    [
      'the rule keeps interfaces that use `this` now (TS2526): remove usesThisType and its use in src/internal/fixes.ts',
      typeDefinitions,
      'interface A {\n  self(): this\n}\n',
      'type A = {\n  self(): this\n}\n',
    ],
    [
      'the rule keeps these interfaces now: delete `patchTypeDefinitions` and its use in src/internal/fixes.ts',
      typeDefinitions,
      "export {}\ndeclare module 'x' {\n  interface A {\n    a: number\n  }\n}\n",
      "export {}\ndeclare module 'x' {\n  type A = {\n    a: number\n  }\n}\n",
    ],
    [
      'the rule preserves namespace interfaces now: remove the exported namespace guard from mergesWithAnotherDeclaration in src/internal/fixes.ts',
      typeDefinitions,
      'export namespace A { export interface X { a: string } }\nexport namespace A { export interface X { b: number } }',
      'export namespace A { export type X = { a: string } }\nexport namespace A { export type X = { b: number } }',
    ],
    [
      'the rule no longer writes an empty object type: remove emptyExtensionFix and its use in src/internal/fixes.ts',
      typeDefinitions,
      'interface A extends B {}\n',
      'type A = {} & B\n',
    ],
  ])('%s', (message, config, code, output) => {
    expect(linter.verifyAndFix(code, config, fileFor(config)).output, message).toBe(output)
  })

  it.each<[string, Linter.Config | Array<Linter.Config>, string, string]>([
    [
      'eslint/markdown#619 is fixed: drop the removal of the GFM `transforms` in src/internal/markdown/language.ts',
      md({ 'markdown/no-bare-urls': 'error' }),
      '# T\n\n[https://example.com]\n',
      'getRange',
    ],
    [
      'canonical-code-block-language checks own keys now: remove its canonical type guard in src/internal/markdown/rules/canonical-code-block-language.ts',
      md({ 'markdown-preferences/canonical-code-block-language': 'error' }, preferences),
      '# T\n\n```constructor\nx\n```\n',
      "'text' must be a string",
    ],
    [
      "astro/jsx-a11y/* checks own attribute names now: remove the `constructor` part of its entry in the README's Known issues",
      [...astroBase, { files: ['**/*.astro'], rules: { 'astro/jsx-a11y/alt-text': 'error' } }],
      '---\n---\n<img src="a.png" constructor="x" />\n',
      'name.toUpperCase is not a function',
    ],
  ])('%s', (message, config, code, error) => {
    expect(() => linter.verify(code, config, fileFor(config)), message).toThrow(error)
  })

  it.each<[string, Linter.Config | Array<Linter.Config>, string, Array<string>, string?]>([
    [
      'prefer-spread leaves `Array.from(…).map()` to prefer-array-from-map now: in `patchPreferSpread` in src/internal/fixes.ts, delete the drop of `mappedCalls` and its `arrayFromMapCompanions`, and the whole patch if the canary of `Array.from(arrayLike)` fails too',
      { plugins: { unicorn: eslintPluginUnicorn }, rules: { 'unicorn/prefer-spread': 'error' } },
      'Array.from(s).map((x) => x)\n',
      ['unicorn/prefer-spread'],
    ],
    [
      'unicorn skips `__placeholder__.js` now: delete its pattern from `FILENAME_CASE_IGNORES` in src/internal/configs/constants.ts',
      {
        plugins: { unicorn: eslintPluginUnicorn },
        rules: { 'unicorn/filename-case': ['error', { case: 'kebabCase' }] },
      },
      'export const a = 1\n',
      ['unicorn/filename-case'],
      // The name `ESLint#lintText` gives text without a file name
      '__placeholder__.js',
    ],
    [
      'sonarjs/unverified-certificate checks constructors now: delete `patchUnverifiedCertificate` in src/internal/rule-patches.ts, or keep only the cases it still misses',
      {
        plugins: { sonarjs: eslintPluginSonarjs },
        rules: { 'sonarjs/unverified-certificate': 'error' },
      },
      "import https from 'node:https'\n\nexport const a = new https.Agent({ rejectUnauthorized: false })\n",
      [],
    ],
    [
      'the rules agree on `[...m.keys()].map()` now: delete `patchArrayFromMap` in src/internal/fixes.ts and its allowed overlap in src/internal/duplicate-rules.ts',
      {
        plugins: { e18e: eslintPluginE18e, unicorn: eslintPluginUnicorn },
        rules: {
          'e18e/prefer-array-from-map': 'error',
          'unicorn/prefer-iterator-to-array': 'error',
        },
      },
      '[...m.keys()].map((x) => x)\n',
      ['e18e/prefer-array-from-map', 'unicorn/prefer-iterator-to-array'],
    ],
    [
      'Astro templates read HTML comment directives now: give an Astro block without front matter `<!-- … -->` directives in getCommentPlacement in src/internal/markdown/processor/comments.ts',
      [...astroBase, { files: ['**/*.astro'], rules: { 'astro/no-set-html-directive': 'error' } }],
      '<!-- eslint-disable astro/no-set-html-directive -->\n<p set:html="a" />\n',
      ['astro/no-set-html-directive'],
    ],
    [
      'eslint-plugin-n skips types now: delete `patchUnsupportedFeatures` in src/internal/presets/node.ts',
      {
        files: ['**/*.ts'],
        languageOptions: { parser: tseslint.parser, globals: globals.node },
        plugins: { n: eslintPluginNode },
        settings: { n: { version: '>=20.0.0' } },
        rules: { 'n/no-unsupported-features/node-builtins': 'error' },
      },
      'export async function get(): Promise<Response> {\n  return Promise.reject(new Error("x"))\n}\n',
      ['n/no-unsupported-features/node-builtins'],
    ],
  ])('%s', (message, config, code, ruleIds, file = fileFor(config)) => {
    const ids = linter.verify(code, config, file).map((problem) => problem.ruleId ?? '')
    expect(ids.toSorted(collator.compare), message).toEqual(ruleIds)
  })

  it.each<[string, Linter.Config, string, Array<string>]>([
    [
      "slop/no-em-dash reports Markdown's columns now: drop the column shift of wrapSlopPlugin in src/internal/presets/antislop.ts, keeping `lfLines` while the line canary below fails",
      md({ 'slop/no-em-dash': 'error' }, { slop }),
      '# T\n\nA \u{2014} b\n',
      ['3:0'],
    ],
    [
      'slop/no-em-dash counts a lone `\\r` as a line break now, so the stock rule that wrapSlopPlugin in src/internal/presets/antislop.ts runs for an `inspection` of changed lines needs no `lfLines`: keep `lfLines` for the own linear rule only, which still counts only `\\n`',
      { plugins: { slop }, rules: { 'slop/no-em-dash': 'error' } },
      '// a.\r\r// b \u{2014} c\r',
      ['1:8'],
    ],
    [
      "require-description reports Markdown's columns now: drop the withLanguageColumnsRule wrapper and withPresetEslintCommentsPlugin in src/internal/configs/eslint-comments.ts, and src/internal/language-columns.ts once slop's is gone too",
      md(
        { '@eslint-community/eslint-comments/require-description': 'error' },
        { '@eslint-community/eslint-comments': eslintPluginComments },
      ),
      '# T\n\n<!-- eslint-disable markdown/no-html -->\n\nText\n',
      ['3:-1'],
    ],
  ])('%s', (message, config, code, positions) => {
    const actual = linter
      .verify(code, config, fileFor(config))
      .filter((problem) => problem.ruleId !== null)
      .map((problem) => `${String(problem.line)}:${String(problem.column)}`)
    expect(actual, message).toEqual(positions)
  })

  it('`@eslint/markdown` still locates a directive in a tab-indented list item past its comment', () => {
    const config = { ...md({}), linterOptions: { reportUnusedDisableDirectives: 'error' as const } }
    const verify = (text: string) => linter.verify(text, config, 'doc.md')
    expect(() => {
      verify('- item\n\t<!-- eslint-disable no-var -->\n')
    }, 'directive offsets follow the source text now: remove GpahalMarkdownSourceCode in src/internal/markdown/language.ts').toThrow(
      RangeError,
    )
    // The throw leaves upstream's global comment regex's `lastIndex` past the comment, so a later
    // file's first comment is skipped. A shorter text resets it for later tests
    verify('<!-- eslint-disable -->\n')
  })

  it('`markdown/no-reversed-media-syntax` still rewrites a link before brackets, or takes exponential time', () => {
    const config = md({ 'markdown/no-reversed-media-syntax': 'error' })
    const isMasked = ['See [docs](https://a.dev)[^1] here.\n', 'Take f(x)[0] here.\n'].every(
      (text) => linter.verifyAndFix(text, config, 'doc.md').output === text,
    )
    // Timed only once the fixes are right, since a slow rule takes about 11 s here
    const isSlow = (): boolean => {
      const start = performance.now()
      linter.verify(`(${'(a)'.repeat(30)})x\n`, config, 'doc.md')
      return performance.now() - start > 2000
    }
    expect(
      !isMasked || isSlow(),
      'no-reversed-media-syntax masks links and footnotes and is fast now: re-enable it in src/internal/configs/markdown.ts',
    ).toBe(true)
  })

  it('`slop/no-em-dash` still finds each position by splitting the text before it', async () => {
    const source = await fs.readFile(
      createRequire(import.meta.url).resolve('eslint-plugin-slop'),
      'utf8',
    )
    const rule = source.slice(source.indexOf('//#region src/rules/no-em-dash.ts'))
    const position = /function getPosition\$?\d*\(text, index\) \{[^}]*\}/.exec(rule)?.[0] ?? ''
    expect(
      position.includes('.slice(0,') && position.includes('.split('),
      'slop/no-em-dash finds positions in linear time now: drop the own no-em-dash of wrapSlopPlugin in src/internal/presets/antislop.ts, keeping the column wrapper while the canaries above fail',
    ).toBe(true)
  })

  it('`import-x/no-extraneous-dependencies` still crashes on a file with no package.json at or above it', async () => {
    await using project = await withTmpProject('eslint-config', {
      'node_modules/foo/index.js': 'module.exports = 1\n',
    })
    const eslint = new ESLint({
      cwd: project.dir,
      overrideConfigFile: true,
      overrideConfig: {
        plugins: { 'import-x': eslintPluginImportX },
        rules: { 'import-x/no-extraneous-dependencies': 'error' },
      },
    })
    await expect(
      eslint.lintText("import a from 'foo'\n\nexport default a\n", {
        filePath: path.join(project.dir, 'a.js'),
      }),
      "import-x/no-extraneous-dependencies runs without a package.json now: remove its entry from the README's Known issues",
    ).rejects.toThrow('The "path" argument must be of type string. Received null')
  })

  it("eslint-plugin-astro still doesn't indent the later lines of a multi-line fix in a `<script>` block", () => {
    const split: Rule.RuleModule = {
      meta: { fixable: 'code' },
      create: (context) => ({
        VariableDeclaration(node) {
          const fix = (fixer: Rule.RuleFixer) => fixer.replaceText(node, 'const a = 1\nconst b = 2')
          context.report({ node, message: 'Split.', fix })
        },
      }),
    }
    const [message] = linter.verify(
      '---\n---\n<script>\n  const a = 1\n</script>\n',
      [
        ...astroBase,
        {
          files: ['**/*.astro/*.ts'],
          languageOptions: { parser: tseslint.parser },
          plugins: { stub: { rules: { split } } },
          rules: { 'stub/split': 'error' },
        },
      ],
      // `Linter` lints only `.js` blocks unless told otherwise
      { filename: 'page.astro', filterCodeBlock: () => true },
    )
    expect(
      message?.fix?.text,
      'eslint-plugin-astro indents multi-line fixes in `<script>` blocks now: remove `ASTRO_VIRTUAL_FILE_REGEX` and `allowsFixes` in src/internal/comment-layout/index.ts',
    ).toBe('const a = 1\nconst b = 2')
  })

  it("e18e's and @eslint-react's rules that need type information still don't flag it", () => {
    const flagged = UNFLAGGED_TYPED_RULES.filter((name) => {
      const [plugin, rules] = name.startsWith('e18e/')
        ? ['e18e/', eslintPluginE18e.rules]
        : ['@eslint-react/', eslintPluginReact.rules]
      const docs: unknown = rules?.[name.slice(plugin.length)]?.meta?.docs
      return isRecord(docs) && docs['requiresTypeChecking'] === true
    })
    expect(
      flagged,
      'these plugins flag their typed rules now: remove them from UNFLAGGED_TYPED_RULES in src/internal/rules.ts',
    ).toEqual([])
  })

  it("eslint-typegen still sorts rules by the process's locale", async () => {
    const plugins: Record<string, ESLint.Plugin> = {
      z: { rules: { 'ä-rule': rule('Ä'), 'a-rule': rule('A') } },
    }
    const locales: Array<unknown> = []
    const localeCompare = vi.spyOn(String.prototype, 'localeCompare').mockImplementation(function (
      this: string,
      that: string,
      ...rest: Array<unknown>
    ) {
      locales.push(rest[0])
      return collator.compare(this, that)
    })
    try {
      await pluginsToRulesDTS(plugins, { includeAugmentation: false })
    } finally {
      localeCompare.mockRestore()
    }
    expect(
      locales.length > 0 && locales.every((locale) => locale === undefined),
      'eslint-typegen sorts without the locale now: use its pluginsToRulesDTS in scripts/typegen.ts and remove the pluginsToRulesDts fork',
    ).toBe(true)
  })

  it.each<[string, NonNullable<Linter.Config['plugins']>, string, string, string | Array<string>]>([
    [
      'the rules leave `Array.from(arrayLike)` alone now: delete `isNonIterableArrayFrom` and its use in `patchPreferSpread` in src/internal/fixes.ts, for the rules that stopped reporting it',
      { e18e: eslintPluginE18e, unicorn: eslintPluginUnicorn },
      'e18e/prefer-spread-syntax unicorn/prefer-spread',
      'export function copy(list: ArrayLike<number>): Array<number> {\n  return Array.from(list)\n}\n',
      ['e18e/prefer-spread-syntax', 'unicorn/prefer-spread'],
    ],
    [
      'prefer-regexp-exec leaves a match as a condition to prefer-regexp-test now: delete `patchRegexpExec` in src/internal/fixes.ts',
      { '@typescript-eslint': tseslint.plugin },
      '@typescript-eslint/prefer-regexp-exec',
      'export function check(s: string): number {\n  return s.match(/a/) ? 1 : 2\n}\n',
      ['@typescript-eslint/prefer-regexp-exec'],
    ],
    [
      'no-meaningless-void-operator leaves `void` of a non-call, or guards its fix against ASI, now: delete `patchMeaninglessVoid` in src/internal/rule-patches.ts, and audit whether it can leave REPORT_ONLY_RULES in src/internal/fixes.ts',
      { '@typescript-eslint': tseslint.plugin },
      '@typescript-eslint/no-meaningless-void-operator',
      'export function run(record: () => void): void {\n  record()\n  void (1 + 2)\n}\n',
      'export function run(record: () => void): void {\n  record()\n  (1 + 2)\n}\n',
    ],
  ])('%s', async (message, plugins, ruleIds, code, expected) => {
    const rules = Object.fromEntries(ruleIds.split(' ').map((id) => [id, 'error' as const]))
    expect(await typedLint(plugins, rules, code, typeof expected === 'string'), message).toEqual(
      expected,
    )
  })

  it('minimatch still splits an extglob alternation at an escaped `|`', () => {
    const { minimatch } = createRequire(createRequire(import.meta.url).resolve('eslint'))(
      'minimatch',
    ) as { minimatch: (path: string, pattern: string, options: { dot: boolean }) => boolean }
    expect(
      minimatch('a|b/dist/x.js', String.raw`@(a\|b|c)/dist/**`, { dot: true }),
      'minimatch reads an escaped `|` in an alternation now: delete the `[|]` replacement in joinSiblingGlob in src/internal/globs.ts',
    ).toBe(false)
  })

  it('eslint-plugin-astro still loads the TypeScript parser and jsx-a11y from the working directory', async () => {
    // A project with neither installed, as a pnpm project that doesn't list them sees it
    await using project = await withTmpProject('eslint-config', {
      'package.json': '{ "name": "astro" }\n',
    })
    const stdout = await runNodeOk(
      [
        '--input-type=module',
        '--eval',
        String.raw`
const { default: astro } = await import(process.env.ASTRO_URL)
const { Linter } = await import(process.env.ESLINT_URL)
const configs = astro.configs['flat/recommended']
const base = configs.find((config) => config.name === 'astro/base')
const messages = new Linter({ configType: 'flat' }).verify(
  '---\n---\n<img src="a.png" />\n',
  [...configs, { rules: { 'astro/jsx-a11y/alt-text': 'error' } }],
  'page.astro',
)
console.log(JSON.stringify({ parser: base.languageOptions.parserOptions.parser ?? null, messages: messages.map((message) => message.message) }))
`,
      ],
      {
        cwd: project.dir,
        env: {
          ASTRO_URL: import.meta.resolve('eslint-plugin-astro'),
          ESLINT_URL: import.meta.resolve('eslint'),
        },
      },
    )
    const { parser, messages } = JSON.parse(stdout) as {
      parser: unknown
      messages: Array<string>
    }
    expect(
      parser,
      "eslint-plugin-astro finds the TypeScript parser itself now: drop `parserOptions.parser` and the `gpahal/astro/script-parser` config's parser in src/internal/presets/astro.ts, which pass this package's",
    ).toBeNull()
    expect(
      messages.join('\n'),
      "eslint-plugin-astro loads jsx-a11y from its own dependencies now: drop `checkJsxA11y` in src/internal/presets/astro.ts and the README's note to install eslint-plugin-jsx-a11y-x",
    ).toContain('you need to install eslint-plugin-jsx-a11y or eslint-plugin-jsx-a11y-x')
  })

  it('astro-eslint-parser still gives template JSX the error type without `@types/react`', async () => {
    await using project = await withTmpProject('eslint-config', {
      'eslint.config.mjs': 'export default []\n',
      'package.json': '{ "name": "a", "private": true, "type": "module" }\n',
      'tsconfig.json': '{ "compilerOptions": { "strict": true, "module": "esnext" } }',
      'page.astro':
        '---\nconst items = [1, 2]\n---\n\n<ul>\n  {items.map((n) => <li>{n}</li>)}\n</ul>\n',
    })
    const eslint = new ESLint({
      cwd: project.dir,
      overrideConfigFile: true,
      overrideConfig: [
        ...(await defineConfig({ root: project.dir, astro: true, isInEditor: false })),
        { files: ['**/*.astro'], rules: { '@typescript-eslint/no-unsafe-return': 'error' } },
      ],
    })
    const [result] = await eslint.lintFiles(['page.astro'])
    expect(
      result?.messages.map((message) => message.ruleId),
      'astro-eslint-parser types template JSX without `@types/react` now: drop the typescript-eslint rules of `ASTRO_TEMPLATE_RULES` in src/internal/presets/astro.ts',
    ).toEqual(['@typescript-eslint/no-unsafe-return'])
  })

  it("the import resolver's tinyglobby still misses the tsconfig files under its working directory, and finds node_modules ones", async () => {
    await using project = await withTmpProject('eslint-config', {
      'tsconfig.json': '{}',
      'app/src/tsconfig.json': '{}',
      'node_modules/dep/tsconfig.json': '{}',
    })
    // Called as eslint-import-resolver-typescript calls it to expand `project` globs
    const resolverRequire = createRequire(
      createRequire(import.meta.url).resolve('eslint-import-resolver-typescript'),
    )
    const { globSync } = resolverRequire('tinyglobby') as {
      globSync: (patterns: Array<string>, options: object) => Array<string>
    }
    const files = globSync([`${project.dir}/**/tsconfig.json`], {
      absolute: true,
      cwd: path.join(project.dir, 'app'),
      dot: true,
      expandDirectories: false,
      onlyFiles: false,
      ignore: '**/node_modules/**',
    })
    expect(
      files.map((file) => path.relative(project.dir, file)).toSorted(collator.compare),
      "tinyglobby finds a pattern's files from any working directory now: pass the resolver a `**/tsconfig.json` glob rather than the files the walk in src/internal/project-scan.ts finds",
    ).toEqual(['node_modules/dep/tsconfig.json', 'tsconfig.json'])
  })

  it("eslint-import-resolver-typescript still drops the tsconfig paths of several projects when ESLint's `cwd` isn't the working directory", async () => {
    const eslint = await createESLint('monorepo', {
      packageJson: false,
      extraConfigs: [{ files: ['**/*.ts'], rules: { 'import-x/no-unresolved': 'error' } }],
    })
    expect(
      Object.values(await lint(eslint, ['.'], (message) => message.ruleId ?? 'fatal')).flat(),
      "eslint-import-resolver-typescript resolves each project's paths from any working directory now: remove the `process.chdir` of the `import resolver` tests in tests/presets-project.test.ts, and the note on it in its `import resolver tsconfig files` tests",
    ).toContain('import-x/no-unresolved')
  })

  // In a process of their own: typescript-eslint's project service lives as long as the process
  it.concurrent.each([
    [
      'typescript-eslint keeps a project service per config now: remove the reservation check from src/internal/project-service.ts',
      'b',
      'b.config.ts',
      'was not found by the project service',
    ],
    [
      'typescript-eslint matches files through symbolic links now: remove `rootFor` from src/internal/project-service.ts',
      'link',
      'a.config.ts',
      'was not found by the project service',
    ],
    [
      'typescript-estree words this error differently now: update `DEFAULT_PROJECT_CONFLICT` in src/internal/project-service.ts',
      'c',
      'c.config.ts',
      DEFAULT_PROJECT_CONFLICT,
    ],
  ])('%s', async (message, dir, file, expected) => {
    await using project = await withTmpProject('eslint-config-project-service')
    const tsconfig = '{ "include": ["src"] }\n'
    await writeFiles(project.dir, {
      'a/tsconfig.json': tsconfig,
      'a/a.config.ts': 'export default {}\n',
      'b/tsconfig.json': tsconfig,
      'b/b.config.ts': 'export default {}\n',
      'c/tsconfig.json': tsconfig,
      'c/src/index.ts': "export { default } from '../c.config.js'\n",
      'c/c.config.ts': 'export default {}\n',
    })
    await fs.symlink(path.join(project.dir, 'a'), path.join(project.dir, 'link'))
    const script = String.raw`
const { parser } = await import('typescript-eslint')
const parse = (root, globs, file) => {
  try {
    parser.parseForESLint('export default {}\n', {
      filePath: file,
      tsconfigRootDir: root,
      projectService: { allowDefaultProject: globs },
    })
    return 'parsed'
  } catch (error) {
    return error.message
  }
}
const { DIR: dir, ROOT: name, FILE: file } = process.env
if (name !== 'c') {
  parse(dir + '/a', ['a.config.ts'], dir + '/a/a.config.ts')
}
const root = name === 'link' ? dir + '/a' : dir + '/' + name
console.log(parse(root, [file], dir + '/' + name + '/' + file))
`
    const output = await runNodeOk(['--input-type=module', '--eval', script], {
      cwd: path.join(import.meta.dirname, '..'),
      env: { DIR: project.dir, ROOT: dir, FILE: file },
    })
    expect(output, message).toContain(expected)
  })
})
