import type { ESLint, Rule } from 'eslint'

import { isRecord } from '@gpahal/std/objects'

import { CODE_BLOCK_FILES, JSON_FILES, TOML_FILES, YAML_FILES } from '@/internal/files'
import type { FileSpecs } from '@/internal/globs'
import { lfLineStarts, withLanguageColumnsRule } from '@/internal/language-columns'
import { withSetup } from '@/internal/naming'
import { importPeers, interopDefault } from '@/internal/peers'
import type { AntislopOptions, TypedConfig, TypedRules } from '@/internal/types'
import { registerWrappedPlugin, withPresetPlugin } from '@/internal/utils'

/**
 * From antfu's list. Not `no-inverted-boolean-check`: inverting `!(a > b)` changes what it does
 * with `NaN`, and `unicorn/no-negated-comparison` already fixes the safe equality cases
 */
const SONARJS_RULES: TypedRules = {
  'sonarjs/no-all-duplicated-branches': 'error',
  'sonarjs/no-commented-code': 'error',
  'sonarjs/no-duplicated-branches': 'error',
  'sonarjs/no-element-overwrite': 'error',
  'sonarjs/no-empty-collection': 'error',
  'sonarjs/no-gratuitous-expressions': 'error',
  'sonarjs/no-identical-expressions': 'error',
  'sonarjs/no-identical-functions': 'error',
  'sonarjs/no-invariant-returns': 'error',
  'sonarjs/no-redundant-boolean': 'error',
  'sonarjs/no-redundant-jump': 'error',
  'sonarjs/no-unused-collection': 'error',
  'sonarjs/no-use-of-empty-return-value': 'error',
  'sonarjs/prefer-single-boolean-return': 'error',
}

/**
 * Not `prefer-jsdoc`, which makes a doc block of a `//` comment even across a blank line, where
 * `@gpahal/comment-layout` keeps it a `//` comment
 */
const SLOP_RULES: TypedRules = {
  'slop/max-comment-length': 'error',
  'slop/no-em-dash': 'error',
  'slop/no-chained-type-assertions': 'error',
  'slop/no-jargon': 'error',
  'slop/no-trivial-functions': 'error',
  'slop/no-trivial-type-aliases': 'error',
}

export type AntislopPresetOptions = Omit<AntislopOptions, 'rules'> & {
  files: Array<string>
  testFiles: FileSpecs
}

/**
 * So every config in the process registers the same object under `slop`, as ESLint requires
 */
const WRAPPED_SLOP_PLUGINS = new WeakMap<ESLint.Plugin, ESLint.Plugin>()

const SENTENCE_TERMINATORS = new Set(['.', '!', '?'])

type Range = { start: number; end: number }

function isSentenceBreak(char: string | undefined): boolean {
  return char === '\n' || SENTENCE_TERMINATORS.has(char ?? '')
}

/**
 * As eslint-plugin-slop 0.1.3's `no-em-dash` finds them: from the last `\n` or `.!?` before the dash
 * to the next `\n` or past the next `.!?`, trimmed. Linear, since a sentence reaches back past an
 * earlier dash only when both are in it
 */
function emDashSentences(text: string): Array<Range> {
  const sentences: Array<Range> = []
  let previous = -1
  for (
    let index = text.indexOf('\u{2014}');
    index !== -1;
    index = text.indexOf('\u{2014}', index + 1)
  ) {
    let start = index
    while (start > previous + 1 && !isSentenceBreak(text[start - 1])) {
      start -= 1
    }
    const isSameSentence = previous !== -1 && start === previous + 1
    previous = index
    if (isSameSentence) {
      continue
    }
    let end = index + 1
    while (
      end < text.length &&
      text[end] !== '\n' &&
      !SENTENCE_TERMINATORS.has(text[end - 1] ?? '')
    ) {
      end += 1
    }
    while (start < index && /\s/.test(text[start] ?? '')) {
      start += 1
    }
    while (end > index + 1 && /\s/.test(text[end - 1] ?? '')) {
      end -= 1
    }
    sentences.push({ start, end })
  }
  return sentences
}

/**
 * 0.1.3 splits the text before each position, which takes seconds in a long file; this computes line
 * starts once. Same 1-based lines, counting only `\n`, and 0-based columns, which
 * `withLanguageColumnsRule` maps. A non-`full` `inspection`, which checks changed lines with a
 * helper the plugin doesn't export, runs the stock rule
 */
function linearNoEmDash(rule: Rule.RuleModule): Rule.RuleModule {
  return {
    ...rule,
    create(context) {
      const options: unknown = context.options[0]
      const settings: unknown = context.settings['slop']
      // As the plugin reads them: the settings count only with a string `cwd`
      const inspection: unknown =
        (isRecord(options) ? options['inspection'] : undefined) ??
        (isRecord(settings) && typeof settings['cwd'] === 'string'
          ? settings['inspection']
          : undefined)
      const mode = isRecord(inspection) ? inspection['mode'] : inspection
      if (mode !== 'full' && Boolean(inspection)) {
        return rule.create(context)
      }
      let isInspected = false
      const inspect = (): void => {
        if (isInspected) {
          return
        }
        isInspected = true
        const { text } = context.sourceCode
        // Lazily, as most files have no em dash
        let lineStarts: Array<number> | undefined
        const positionOf = (index: number): { line: number; column: number } => {
          lineStarts ??= lfLineStarts(text)
          let low = 0
          let high = lineStarts.length
          while (low < high) {
            const middle = (low + high) >>> 1
            if ((lineStarts[middle] ?? 0) <= index) {
              low = middle + 1
            } else {
              high = middle
            }
          }
          return { line: low, column: index - (lineStarts[low - 1] ?? 0) }
        }
        for (const { start, end } of emDashSentences(text)) {
          context.report({
            loc: { start: positionOf(start), end: positionOf(end) },
            messageId: 'avoid',
          })
        }
      }
      return {
        Program: inspect,
        StyleSheet: inspect,
        Document(node: { parent?: { type?: string } | null }) {
          if (node.parent?.type !== 'Program') {
            inspect()
          }
        },
        root: inspect,
      }
    },
  }
}

/**
 * The same object for the same `plugin`. In 0.1.3, `no-em-dash` reports JavaScript's 0-based columns
 * in every file
 */
export function wrapSlopPlugin(plugin: ESLint.Plugin): ESLint.Plugin {
  let wrapped = WRAPPED_SLOP_PLUGINS.get(plugin)
  if (wrapped === undefined) {
    const rule = plugin.rules?.['no-em-dash']
    const linear =
      rule && 'create' in rule
        ? { ...plugin, rules: { ...plugin.rules, 'no-em-dash': linearNoEmDash(rule) } }
        : plugin
    wrapped = registerWrappedPlugin(
      withLanguageColumnsRule(linear, 'no-em-dash', { lfLines: true }),
      plugin,
    )
    WRAPPED_SLOP_PLUGINS.set(plugin, wrapped)
  }
  return wrapped
}

/**
 * ESLint would reject the stock plugin as a second `slop`. Only with the preset's `slop` on
 */
export async function withPresetSlopPlugin(
  configs: Array<TypedConfig>,
  slop: AntislopOptions['slop'],
): Promise<Array<TypedConfig>> {
  if (slop === false || configs.every((config) => config.plugins?.['slop'] === undefined)) {
    return configs
  }
  const upstream = await interopDefault(import('eslint-plugin-slop'))
  return withPresetPlugin(configs, 'slop', wrapSlopPlugin(upstream))
}

export const SLOP_PEER = 'eslint-plugin-slop'

export const ANTISLOP_MARKDOWN_RULES: TypedRules = {
  'slop/no-em-dash': 'error',
}

/**
 * Each when its area, which sets the language the rule needs, is on
 */
export function antislopDataFiles({
  json,
  yaml,
  toml,
}: {
  json: boolean
  yaml: boolean
  toml: boolean
}): Array<string> {
  return [...(json ? JSON_FILES : []), ...(yaml ? YAML_FILES : []), ...(toml ? TOML_FILES : [])]
}

/**
 * Tests repeat their setup and callbacks on purpose, so each reads alone
 */
export function antislopExemptions({
  testFiles,
  sonarjs = true,
}: Pick<AntislopPresetOptions, 'testFiles' | 'sonarjs'>): Array<TypedConfig> {
  return sonarjs
    ? [
        {
          name: 'gpahal/antislop/sonarjs-tests',
          files: testFiles,
          rules: {
            'sonarjs/no-identical-functions': 'off',
          },
        },
      ]
    : []
}

/**
 * Code blocks are examples; the Markdown file around them is checked for em dashes
 */
export async function antislop({
  files,
  slop = true,
  sonarjs = true,
  cognitiveComplexity = 25,
}: AntislopPresetOptions): Promise<Array<TypedConfig>> {
  const [eslintPluginSlop, eslintPluginSonarjs] = await Promise.all([
    slop === false
      ? undefined
      : importPeers('antislop', [SLOP_PEER], async () =>
          interopDefault(import('eslint-plugin-slop')),
        ),
    // A dependency, which the `sonarjs` area registers too
    sonarjs ? interopDefault(import('eslint-plugin-sonarjs')) : undefined,
  ])
  const scope = { files, ignores: CODE_BLOCK_FILES }
  const plugins: Record<string, ESLint.Plugin> = {
    ...(eslintPluginSlop && { slop: wrapSlopPlugin(eslintPluginSlop) }),
    ...(eslintPluginSonarjs && { sonarjs: eslintPluginSonarjs }),
  }
  const slopSettings = typeof slop === 'object' ? slop : undefined
  return withSetup('antislop', [
    {
      name: 'gpahal/antislop/settings',
      plugins,
      ...(slopSettings && { settings: { slop: slopSettings } }),
    },
    ...(eslintPluginSlop
      ? [{ name: 'gpahal/antislop/rules', ...scope, rules: SLOP_RULES } satisfies TypedConfig]
      : []),
    ...(eslintPluginSonarjs
      ? [
          {
            name: 'gpahal/antislop/sonarjs',
            ...scope,
            rules: {
              ...(cognitiveComplexity !== false && {
                'sonarjs/cognitive-complexity': ['error', cognitiveComplexity],
              }),
              ...SONARJS_RULES,
            },
          } satisfies TypedConfig,
        ]
      : []),
  ])
}
