import type { Linter, Rule, SourceCode } from 'eslint'
import type * as ESTree from 'estree'
import type TypeScriptModule from 'typescript'

import { formatNames } from '@gpahal/std/errors'
import { isRecord } from '@gpahal/std/objects'

import {
  isNodeOfType,
  isRuleNode,
  isTypeOnlyImport,
  rangeOf,
  TYPE_WRAPPER_TYPES,
} from '@/internal/ast'
import { getCoreRuleCopies } from '@/internal/core-rules'
import { DUPLICATE_REPORTS } from '@/internal/duplicate-rules'
import { CODE_BLOCK_FILES, MARKDOWN_EXTNS } from '@/internal/files'
import {
  CODE_BLOCK_REPORT_ONLY_RULES,
  EDITOR_REPORT_ONLY_RULES,
  LIBRARY_CONFIG_NAME,
  LIBRARY_REPORT_ONLY_RULES,
  REPORT_ONLY_RULES,
  UNTYPED_REPORT_ONLY_RULES,
} from '@/internal/fix-policy'
import type { Scope } from '@/internal/globs'
import { isRuleOn, parseRuleId } from '@/internal/rules'
import type { TypedConfig } from '@/internal/types'
import { formatErrorMessage, withReport } from '@/internal/utils'

/**
 * Names the rules that report without fixing, as in `{ 'prefer-const': true }`, or `'all'` for
 * `.disableRulesFix()`, which drops the `REPORT_ONLY_EXCEPTIONS` fixes too. An object, since ESLint
 * merges `settings` objects but a later array would replace an earlier one
 */
const REPORT_ONLY_SETTINGS_KEY = '@gpahal/report-only'

const PATCHED = Symbol('@gpahal/eslint-config report-only fixes')

/**
 * So an error about a rule object can name its plugin and rule
 */
const foundRuleIds = new WeakMap<Rule.RuleModule, string>()

function isPatchable(rule: Rule.RuleModule): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(rule, 'create')
  return (
    Object.isExtensible(rule) &&
    (descriptor === undefined || descriptor.writable === true || descriptor.set !== undefined)
  )
}

/**
 * Wraps `rule.create` once per `marker`. The rule object is shared with ESLint and the plugin, so
 * it's changed in place and keeps its name for disable comments. Wraps with different markers
 * compose. Throws on a frozen rule, whose fixes would otherwise run unpatched
 */
export function patchCreateOnce(
  rule: Rule.RuleModule,
  marker: symbol,
  wrap: (create: Rule.RuleModule['create']) => Rule.RuleModule['create'],
): void {
  if (Object.hasOwn(rule, marker)) {
    return
  }
  if (!isPatchable(rule)) {
    const ruleId = foundRuleIds.get(rule)
    const pluginName = ruleId === undefined ? undefined : parseRuleId(ruleId).pluginName
    const owner =
      ruleId === undefined
        ? 'its plugin'
        : pluginName === undefined
          ? 'ESLint'
          : `the plugin ${formatNames([pluginName])}`
    throw new Error(
      formatErrorMessage(
        [ruleId === undefined ? 'rule' : formatNames([ruleId])],
        `${owner} froze the rule object or made its \`create\` read-only, so this package can't patch its fixes. Install a version of the plugin in this package's peer range`,
      ),
    )
  }
  rule.create = wrap(rule.create.bind(rule))
  Object.defineProperty(rule, marker, { value: true })
}

/**
 * `true` keeps the fixes of `REPORT_ONLY_EXCEPTIONS`, and `'all'` drops them too
 */
function reportOnlyOf(context: Rule.RuleContext): true | 'all' | undefined {
  const reportOnly: unknown = context.settings[REPORT_ONLY_SETTINGS_KEY]
  const value = isRecord(reportOnly) ? reportOnly[context.id] : undefined
  return value === true || value === 'all' ? value : undefined
}

/**
 * A class-order report in the plain string `class` attribute of a native element in an `.astro`
 * file. No tailwind-merge call reads that list, so its order is safe to fix, and
 * prettier-plugin-tailwindcss doesn't sort `.astro` files
 */
function isAstroNativeClass(context: Rule.RuleContext, descriptor: Rule.ReportDescriptor): boolean {
  if (!context.filename.endsWith('.astro') || !('loc' in descriptor)) {
    return false
  }
  const start = 'start' in descriptor.loc ? descriptor.loc.start : descriptor.loc
  const value: unknown = context.sourceCode.getNodeByRangeIndex(
    context.sourceCode.getIndexFromLoc(start),
  )
  const attribute: unknown = isRecord(value) ? value['parent'] : undefined
  const element: unknown = isRecord(attribute) ? attribute['parent'] : undefined
  const attributeName: unknown = isRecord(attribute) ? attribute['name'] : undefined
  const elementName: unknown = isRecord(element) ? element['name'] : undefined
  return (
    isRecord(value) &&
    value['type'] === 'Literal' &&
    isRecord(attribute) &&
    attribute['type'] === 'JSXAttribute' &&
    isRecord(attributeName) &&
    attributeName['type'] === 'JSXIdentifier' &&
    attributeName['name'] === 'class' &&
    isRecord(element) &&
    element['type'] === 'JSXOpeningElement' &&
    isRecord(elementName) &&
    elementName['type'] === 'JSXIdentifier' &&
    typeof elementName['name'] === 'string' &&
    /^[a-z]/u.test(elementName['name'])
  )
}

const VALUE_WRAPPER_TYPES: ReadonlySet<string> = new Set([
  'ParenthesizedExpression',
  ...TYPE_WRAPPER_TYPES,
])

/**
 * Whether `parent` can evaluate to the value of its child `node`, as a type assertion, a branch of
 * a conditional or either side of a logical expression does
 */
function passesValue(node: ESTree.Node, parent: ESTree.Node): boolean {
  if (parent.type === 'ConditionalExpression') {
    return parent.test !== node
  }
  if (parent.type === 'SequenceExpression') {
    return parent.expressions.at(-1) === node
  }
  if (parent.type === 'AssignmentExpression') {
    return parent.operator === '=' && parent.right === node
  }
  return parent.type === 'LogicalExpression' || VALUE_WRAPPER_TYPES.has(parent.type)
}

/**
 * Whether the value of `node`, through the expressions that pass it on, is an operand of `+`
 */
function isConcatenated(node: Rule.Node): boolean {
  let child: Rule.Node = node
  let { parent } = child
  while (parent !== null && passesValue(child, parent)) {
    child = parent
    parent = child.parent
  }
  return parent?.type === 'BinaryExpression' && parent.operator === '+'
}

/**
 * A whitespace report that collapses the space between two classes of a plain, single-line string,
 * or trims one end. Template literals, multi-line strings and strings concatenated, even through a
 * conditional or logical expression, stay report-only, since their whitespace can separate the
 * classes they join
 */
function isClassListSpace(context: Rule.RuleContext, descriptor: Rule.ReportDescriptor): boolean {
  if (!('loc' in descriptor) || descriptor.fix == null) {
    return false
  }
  const start = 'start' in descriptor.loc ? descriptor.loc.start : descriptor.loc
  const node: unknown = context.sourceCode.getNodeByRangeIndex(
    context.sourceCode.getIndexFromLoc(start),
  )
  if (!isRuleNode(node) || node.type !== 'Literal' || typeof node.value !== 'string') {
    return false
  }
  const [literalStart, literalEnd] = rangeOf(node)
  const text = context.sourceCode.text.slice(literalStart, literalEnd)
  return (
    !isConcatenated(node) &&
    !text.includes('\n') &&
    recordFix(descriptor.fix).every(
      ({ range, text: replacement }) =>
        /^\s+$/u.test(context.sourceCode.text.slice(range[0], range[1])) &&
        (replacement === ' ' ||
          (replacement === '' && (range[0] === literalStart + 1 || range[1] === literalEnd - 1))),
    )
  )
}

const REPORT_ONLY_EXCEPTIONS: ReadonlyMap<
  string,
  (context: Rule.RuleContext, descriptor: Rule.ReportDescriptor) => boolean
> = new Map([
  ['better-tailwindcss/enforce-consistent-class-order', isAstroNativeClass],
  ['better-tailwindcss/no-unnecessary-whitespace', isClassListSpace],
])

/**
 * In report-only files, `report` drops `fix`, but for `REPORT_ONLY_EXCEPTIONS`, and keeps
 * `suggest`. `meta.fixable` stays, since the rule fixes elsewhere
 */
function patchRule(rule: Rule.RuleModule): void {
  patchCreateOnce(rule, PATCHED, (create) => (context) => {
    const reportOnly = reportOnlyOf(context)
    if (reportOnly === undefined) {
      return create(context)
    }
    const keepsFix = reportOnly === true ? REPORT_ONLY_EXCEPTIONS.get(context.id) : undefined
    return create(
      withReport(context, (descriptor) => {
        context.report(
          keepsFix?.(context, descriptor) === true ? descriptor : { ...descriptor, fix: undefined },
        )
      }),
    )
  })
}

/**
 * Among the core rules of each `eslint` copy that may run the config, and `configs`' plugins
 */
function findRules(
  ruleId: string,
  configs: ReadonlyArray<Pick<Linter.Config, 'plugins'>>,
  root: string,
): Array<Rule.RuleModule> {
  const { pluginName, ruleName } = parseRuleId(ruleId)
  const rules =
    pluginName === undefined
      ? getCoreRuleCopies(ruleName, root)
      : [
          ...new Set(configs.map((config) => config.plugins?.[pluginName]?.rules?.[ruleName])),
        ].filter((rule): rule is Rule.RuleModule => typeof rule === 'object')
  for (const rule of rules) {
    foundRuleIds.set(rule, ruleId)
  }
  return rules
}

/**
 * Throws when ESLint or a loaded plugin has no rule of that name, as after an upstream rename,
 * which would leave its fixes silently unpatched. A plugin that no config loads has nothing to patch
 */
export function findPatchTargets(
  ruleId: string,
  configs: ReadonlyArray<Pick<Linter.Config, 'plugins'>>,
  root: string,
): Array<Rule.RuleModule> {
  const rules = findRules(ruleId, configs, root)
  if (rules.length > 0) {
    return rules
  }
  const { pluginName } = parseRuleId(ruleId)
  if (pluginName === undefined) {
    throw new Error(
      formatErrorMessage(
        [formatNames([ruleId])],
        "is patched or report-only, but isn't a core rule that ESLint has. Install an `eslint` version in this package's peer range",
      ),
    )
  }
  if (configs.some((config) => config.plugins?.[pluginName] !== undefined)) {
    throw new Error(
      formatErrorMessage(
        [formatNames([ruleId])],
        `is patched or report-only, but the loaded plugin ${formatNames([pluginName])} has no such rule. Install a version of the plugin in this package's peer range`,
      ),
    )
  }
  return []
}

/**
 * Whether each rule of `RULES_ON_RULES` is on in a config's files. `withRulesOn` sets it beside
 * every entry, so ESLint's `settings` merge matches its `rules` merge, but for inline comments
 */
const RULES_ON_SETTINGS_KEY = '@gpahal/rules-on'

/**
 * The options of each `RULES_ON_RULES` rule's last entry with options. A severity alone sets none,
 * as it keeps the options in ESLint's merge
 */
const RULES_OPTIONS_SETTINGS_KEY = '@gpahal/rules-options'

/**
 * The settings come from the presets' configs, so a later config or inline comment that turns one
 * on or off doesn't change them
 */
const RULES_ON_RULES: ReadonlyArray<string> = [
  ...new Set(DUPLICATE_REPORTS.flatMap(({ kept }) => kept)),
  'unicorn/prefer-optional-catch-binding',
]

/**
 * A changed config is a copy
 */
export function withRulesOn(configs: ReadonlyArray<TypedConfig>): Array<TypedConfig> {
  return configs.map((config) => {
    // `checkUserConfig` doesn't check a preset's config
    const rules: object = isRecord(config.rules) ? config.rules : {}
    const settings: Record<string, unknown> = isRecord(config.settings) ? config.settings : {}
    const ruleIds = RULES_ON_RULES.filter((ruleId) => Object.hasOwn(rules, ruleId))
    if (ruleIds.length === 0) {
      return config
    }
    const entries = ruleIds.map((ruleId) => [ruleId, isRuleOn(Reflect.get(rules, ruleId))] as const)
    const options = ruleIds.flatMap((ruleId) => {
      const entry: unknown = Reflect.get(rules, ruleId)
      return Array.isArray(entry) && entry.length > 1 ? [[ruleId, entry.slice(1)] as const] : []
    })
    const current: unknown = settings[RULES_ON_SETTINGS_KEY]
    const currentOptions: unknown = settings[RULES_OPTIONS_SETTINGS_KEY]
    return {
      ...config,
      settings: {
        ...settings,
        [RULES_ON_SETTINGS_KEY]: {
          ...(isRecord(current) && current),
          ...Object.fromEntries(entries),
        },
        ...(options.length > 0 && {
          [RULES_OPTIONS_SETTINGS_KEY]: {
            ...(isRecord(currentOptions) && currentOptions),
            ...Object.fromEntries(options),
          },
        }),
      },
    }
  })
}

export function isOnInSettings(context: Rule.RuleContext, ruleId: string): boolean {
  const rulesOn: unknown = context.settings[RULES_ON_SETTINGS_KEY]
  return isRecord(rulesOn) && rulesOn[ruleId] === true
}

export function optionsInSettings(
  context: Rule.RuleContext,
  ruleId: string,
): Array<unknown> | undefined {
  const rulesOptions: unknown = context.settings[RULES_OPTIONS_SETTINGS_KEY]
  const options: unknown = isRecord(rulesOptions) ? rulesOptions[ruleId] : undefined
  return Array.isArray(options) ? options : undefined
}

const DUPLICATES_PATCHED = Symbol('@gpahal/eslint-config no-duplicates fix')

/**
 * `import { type A } from 'a'`, which `@typescript-eslint/no-import-type-side-effects` rewrites.
 * `importKind` is TypeScript syntax, which the ESTree types lack
 */
function isInlineTypeOnlyImport(node: ESTree.ImportDeclaration): boolean {
  return (
    Reflect.get(node, 'importKind') === 'value' &&
    node.specifiers.length > 0 &&
    node.specifiers.every(
      (specifier) =>
        specifier.type === 'ImportSpecifier' && Reflect.get(specifier, 'importKind') === 'type',
    )
  )
}

function isSideEffectImport(node: ESTree.ImportDeclaration): boolean {
  return Reflect.get(node, 'importKind') !== 'type' && node.specifiers.length === 0
}

/**
 * Side-effect and type-only duplicates, whose merge and rewrite leave only `import type`, so the
 * module no longer loads
 */
function dropsSideEffectImport(imports: ReadonlyArray<ESTree.ImportDeclaration>): boolean {
  return (
    imports.some(isSideEffectImport) &&
    imports.some(isTypeOnlyImport) &&
    imports.every((node) => isSideEffectImport(node) || isTypeOnlyImport(node))
  )
}

function hasDefaultSpecifier(node: ESTree.ImportDeclaration): boolean {
  return node.specifiers.some((specifier) => specifier.type === 'ImportDefaultSpecifier')
}

const RECORDING_FIXER: Rule.RuleFixer = {
  insertTextAfter: (nodeOrToken, text) =>
    RECORDING_FIXER.insertTextAfterRange(rangeOf(nodeOrToken), text),
  insertTextAfterRange: (range, text) => ({ range: [range[1], range[1]], text }),
  insertTextBefore: (nodeOrToken, text) =>
    RECORDING_FIXER.insertTextBeforeRange(rangeOf(nodeOrToken), text),
  insertTextBeforeRange: (range, text) => ({ range: [range[0], range[0]], text }),
  remove: (nodeOrToken) => ({ range: rangeOf(nodeOrToken), text: '' }),
  removeRange: (range) => ({ range, text: '' }),
  replaceText: (nodeOrToken, text) => ({ range: rangeOf(nodeOrToken), text }),
  replaceTextRange: (range, text) => ({ range, text }),
}

function recordFix(fix: Rule.ReportFixer): Array<Rule.Fix> {
  const fixes = fix(RECORDING_FIXER)
  if (fixes == null) {
    return []
  }
  return 'range' in fixes ? [fixes] : [...fixes]
}

/**
 * With `prefer-inline`, merging `import type { A }` and `import B` gives `import B, type { A }`,
 * which doesn't parse. A merge that also takes named specifiers moves `type` into the braces and
 * stays
 */
function keepsTypeBeforeDefault(
  declaration: ESTree.ImportDeclaration,
  groupHasDefault: boolean,
  fix: Rule.ReportFixer,
  sourceCode: SourceCode,
): boolean {
  const typeToken = sourceCode.getFirstToken(declaration, 1)
  if (
    !groupHasDefault ||
    Reflect.get(declaration, 'importKind') !== 'type' ||
    typeToken?.value !== 'type' ||
    hasDefaultSpecifier(declaration)
  ) {
    return false
  }
  const [start] = rangeOf(typeToken)
  return recordFix(fix).every(
    ({ range, text }) => !(text === '' && range[0] <= start && start < range[1]),
  )
}

/**
 * Drops `import-x/no-duplicates`' fix, keeping the report, where it leaves invalid code:
 *
 * - With a value import of only inline `type` specifiers, ESLint applies the merge and the
 *   `no-import-type-side-effects` rewrite in one pass, writing `import type { A, type B }` (TS2206)
 * - When `keepsTypeBeforeDefault` says the merge writes `import B, type { A }`
 * - When `dropsSideEffectImport` says the module no longer loads
 */
function patchDuplicateImports(rule: Rule.RuleModule): void {
  patchCreateOnce(rule, DUPLICATES_PATCHED, (create) => (context) => {
    if (!hasPatchedFixes(context)) {
      return create(context)
    }
    const reports: Array<Rule.ReportDescriptor> = []
    const declarations: Array<ESTree.ImportDeclaration & Rule.NodeParentExtension> = []
    const listeners = create(
      withReport(context, (descriptor) => {
        reports.push(descriptor)
      }),
    )
    const { ImportDeclaration: onImport, 'Program:exit': onExit } = listeners
    return {
      ...listeners,
      ImportDeclaration: (node) => {
        declarations.push(node)
        onImport?.(node)
      },
      'Program:exit': (node) => {
        onExit?.(node)
        // A file can hold thousands of reports, so the lookups are maps, built once
        const bySource = new Map<unknown, ESTree.ImportDeclaration & Rule.NodeParentExtension>(
          declarations.map((declaration) => [declaration.source, declaration]),
        )
        const reported = reports.map((descriptor) => ({
          declaration: 'node' in descriptor ? bySource.get(descriptor.node) : undefined,
          module: descriptor.data?.['module'],
        }))
        const groups = new Map<unknown, Map<unknown, Array<ESTree.ImportDeclaration>>>()
        for (const { declaration, module } of reported) {
          if (declaration === undefined) {
            continue
          }
          const byModule =
            groups.get(declaration.parent) ?? new Map<unknown, Array<ESTree.ImportDeclaration>>()
          groups.set(declaration.parent, byModule)
          const group = byModule.get(module) ?? []
          byModule.set(module, group)
          group.push(declaration)
        }
        // Once per group, so many duplicates of one module stay linear
        const facts = new Map<
          ReadonlyArray<ESTree.ImportDeclaration>,
          { isUnsafe: boolean; hasDefault: boolean }
        >()
        const factsOf = (group: ReadonlyArray<ESTree.ImportDeclaration>) => {
          let found = facts.get(group)
          if (found === undefined) {
            found = {
              isUnsafe: group.some(isInlineTypeOnlyImport) || dropsSideEffectImport(group),
              hasDefault: group.some(hasDefaultSpecifier),
            }
            facts.set(group, found)
          }
          return found
        }
        for (const [index, descriptor] of reports.entries()) {
          const { declaration, module } = reported[index] ?? {}
          if (declaration === undefined || descriptor.fix == null) {
            context.report(descriptor)
            continue
          }
          const group = groups.get(declaration.parent)?.get(module) ?? [declaration]
          const { isUnsafe: isGroupUnsafe, hasDefault } = factsOf(group)
          const isUnsafe =
            isGroupUnsafe ||
            keepsTypeBeforeDefault(declaration, hasDefault, descriptor.fix, context.sourceCode)
          context.report(isUnsafe ? { ...descriptor, fix: undefined } : descriptor)
        }
      },
    }
  })
}

/**
 * With `imports.removeUnused`
 */
const REMOVE_UNUSED_IMPORTS_SETTINGS_KEY = '@gpahal/remove-unused-imports'

const UNUSED_IMPORTS_PATCHED = Symbol('@gpahal/eslint-config no-unused-vars import fix')

const REMOVE_SPECIFIER_MESSAGE = 'removeUnusedVar'
const REMOVE_DECLARATION_MESSAGE = 'removeUnusedImportDeclaration'

function isImportSpecifier(
  value: unknown,
): value is
  ESTree.ImportSpecifier | ESTree.ImportDefaultSpecifier | ESTree.ImportNamespaceSpecifier {
  return (
    isNodeOfType(value, 'ImportSpecifier') ||
    isNodeOfType(value, 'ImportDefaultSpecifier') ||
    isNodeOfType(value, 'ImportNamespaceSpecifier')
  )
}

/**
 * `undefined` for another node, such as a variable's or an `import x = require('x')`'s
 */
function getUnusedImport(descriptor: Rule.ReportDescriptor): ESTree.ImportDeclaration | undefined {
  const node: unknown = 'node' in descriptor ? descriptor.node : undefined
  const specifier: unknown = isRecord(node) ? node['parent'] : undefined
  const declaration: unknown = isRecord(specifier) ? specifier['parent'] : undefined
  return isImportSpecifier(specifier) && isNodeOfType(declaration, 'ImportDeclaration')
    ? declaration
    : undefined
}

/**
 * Removes an unused default import up to the `{` or `*`, keeping block comments around the comma.
 * `undefined` for another specifier, and `null` for a line comment, which would comment out the
 * rest of the import
 */
function removeDefaultSpecifierFix(
  descriptor: Rule.ReportDescriptor,
  sourceCode: SourceCode,
): Rule.ReportFixer | null | undefined {
  const node: unknown = 'node' in descriptor ? descriptor.node : undefined
  const defaultSpecifier: unknown = isRecord(node) ? node['parent'] : undefined
  if (!isNodeOfType(defaultSpecifier, 'ImportDefaultSpecifier')) {
    return undefined
  }
  const comma = sourceCode.getTokenAfter(defaultSpecifier)
  const next = comma === null ? null : sourceCode.getTokenAfter(comma)
  if (comma?.value !== ',' || (next?.value !== '{' && next?.value !== '*')) {
    return null
  }
  const comments = [...sourceCode.getCommentsBefore(comma), ...sourceCode.getCommentsAfter(comma)]
  if (comments.some((comment) => comment.type === 'Line')) {
    return null
  }
  const kept = comments
    .map((comment) => `${sourceCode.text.slice(...(comment.range ?? [0, 0]))} `)
    .join('')
  return (fixer) => fixer.replaceTextRange([rangeOf(defaultSpecifier)[0], rangeOf(next)[0]], kept)
}

/**
 * Gives the report its suggestion's fix. A value import with no used specifier becomes a
 * side-effect import, since its module may do something when it loads; a type-only import goes
 */
function withUnusedImportFix(
  descriptor: Rule.ReportDescriptor,
  sourceCode: SourceCode,
): Rule.ReportDescriptor {
  const declaration = getUnusedImport(descriptor)
  if (declaration === undefined || descriptor.fix != null) {
    return descriptor
  }
  const suggestion = descriptor.suggest?.find(
    (suggest) =>
      'messageId' in suggest &&
      (suggest.messageId === REMOVE_SPECIFIER_MESSAGE ||
        suggest.messageId === REMOVE_DECLARATION_MESSAGE),
  )
  if (suggestion === undefined) {
    return descriptor
  }
  const removesDeclaration =
    'messageId' in suggestion && suggestion.messageId === REMOVE_DECLARATION_MESSAGE
  const defaultFix = removesDeclaration
    ? undefined
    : removeDefaultSpecifierFix(descriptor, sourceCode)
  if (defaultFix !== undefined) {
    return defaultFix === null ? descriptor : { ...descriptor, fix: defaultFix }
  }
  // The rule suggests removing the whole import for `import d, * as ns from 'x'`
  const isNamespaceBesideDefault =
    declaration.specifiers.length > 1 &&
    declaration.specifiers.some((specifier) => specifier.type === 'ImportNamespaceSpecifier')
  if (isNamespaceBesideDefault) {
    return descriptor
  }
  if (!removesDeclaration) {
    return { ...descriptor, fix: suggestion.fix }
  }
  if (isTypeOnlyImport(declaration)) {
    return { ...descriptor, fix: suggestion.fix }
  }
  return { ...descriptor, fix: sideEffectImportFix(declaration, sourceCode) }
}

function sideEffectImportFix(
  declaration: ESTree.ImportDeclaration,
  sourceCode: SourceCode,
): Rule.ReportFixer {
  const [start, end] = rangeOf(declaration)
  // Import attributes, as in `with { type: 'json' }`, and the semicolon stay
  const rest = sourceCode.text.slice(rangeOf(declaration.source)[0], end)
  return (fixer) => fixer.replaceTextRange([start, end], `import ${rest}`)
}

const CORE_REMOVE_MESSAGE = 'removeVar'

/**
 * As `withUnusedImportFix` for core `no-unused-vars`. A suggestion that removes an import of
 * several specifiers, a used one among them, gives no fix
 */
function withCoreUnusedImportFix(
  descriptor: Rule.ReportDescriptor,
  sourceCode: SourceCode,
): Rule.ReportDescriptor {
  const declaration = getUnusedImport(descriptor)
  if (declaration === undefined || descriptor.fix != null) {
    return descriptor
  }
  const suggestion = descriptor.suggest?.find(
    (suggest) => 'messageId' in suggest && suggest.messageId === CORE_REMOVE_MESSAGE,
  )
  if (suggestion === undefined) {
    return descriptor
  }
  const [start, end] = rangeOf(declaration)
  const removesDeclaration = recordFix(suggestion.fix).some(
    ({ range }) => range[0] <= start && end <= range[1],
  )
  if (!removesDeclaration) {
    return { ...descriptor, fix: suggestion.fix }
  }
  return declaration.specifiers.length === 1
    ? { ...descriptor, fix: sideEffectImportFix(declaration, sourceCode) }
    : descriptor
}

function patchUnusedImports(rule: Rule.RuleModule, isCore: boolean): void {
  const withFix = isCore ? withCoreUnusedImportFix : withUnusedImportFix
  // ESLint rejects a fix from a rule without `meta.fixable`
  if (isCore && rule.meta !== undefined && rule.meta.fixable === undefined) {
    rule.meta.fixable = 'code'
  }
  patchCreateOnce(rule, UNUSED_IMPORTS_PATCHED, (create) => (context) => {
    if (context.settings[REMOVE_UNUSED_IMPORTS_SETTINGS_KEY] !== true) {
      return create(context)
    }
    return create(
      withReport(context, (descriptor) => {
        context.report(withFix(descriptor, context.sourceCode))
      }),
    )
  })
}

/**
 * `[]` in an editor, where a fix on save would remove an import about to be used
 */
export function removeUnusedImportsFixes({
  configs,
  root,
  isInEditor,
}: {
  configs: ReadonlyArray<TypedConfig>
  root: string
  isInEditor: boolean
}): Array<TypedConfig> {
  if (isInEditor) {
    return []
  }
  for (const rule of findPatchTargets('@typescript-eslint/no-unused-vars', configs, root)) {
    patchUnusedImports(rule, false)
  }
  for (const rule of findPatchTargets('no-unused-vars', configs, root)) {
    patchUnusedImports(rule, true)
  }
  return [
    {
      name: 'gpahal/fixes/remove-unused-imports',
      settings: { [REMOVE_UNUSED_IMPORTS_SETTINGS_KEY]: true },
    },
  ]
}

const TYPE_DEFINITIONS_PATCHED = Symbol(
  '@gpahal/eslint-config consistent-type-definitions augmentations',
)

/**
 * In `declare global`, or an ambient `declare module` or `declare namespace`, only an interface
 * can augment, so the report is dropped
 */
function isInAmbientModule(node: Rule.Node): boolean {
  for (let current: Rule.Node | null = node.parent; current; current = current.parent) {
    if (
      (current.type as string) === 'TSModuleDeclaration' &&
      (Reflect.get(current, 'declare') === true || Reflect.get(current, 'kind') === 'global')
    ) {
      return true
    }
  }
  return false
}

/**
 * Modules by extension, Astro components and the virtual files of their scripts
 */
const MODULE_FILE_REGEX = /\.(?:[cm]tsx?|astro)$|\.astro[/\\]/u

const CODE_BLOCK_FILE_REGEX = new RegExp(String.raw`\.(?:${MARKDOWN_EXTNS.join('|')})[/\\]`, 'u')

function isModuleIndicator(statement: ESTree.Node): boolean {
  switch (statement.type as string) {
    case 'ImportDeclaration':
    case 'ExportNamedDeclaration':
    case 'ExportDefaultDeclaration':
    case 'ExportAllDeclaration':
    case 'TSExportAssignment': {
      return true
    }
    case 'TSImportEqualsDeclaration': {
      const reference: unknown = Reflect.get(statement, 'moduleReference')
      return isRecord(reference) && reference['type'] === 'TSExternalModuleReference'
    }
    default: {
      return false
    }
  }
}

/**
 * A script, whose top-level declarations are global: not a module by name and without top-level
 * `import` or `export`. Reads only syntax, so `moduleDetection: force` isn't seen
 */
function isScriptFile(sourceCode: SourceCode, filename: string): boolean {
  return !MODULE_FILE_REGEX.test(filename) && !sourceCode.ast.body.some(isModuleIndicator)
}

export type TypeServices = {
  program: TypeScriptModule.Program
  esTreeNodeToTSNodeMap: {
    get: (
      node: unknown,
    ) => (TypeScriptModule.Node & { readonly name?: TypeScriptModule.Node }) | undefined
  }
}

export function isTypeServices(value: unknown): value is TypeServices {
  if (!isRecord(value)) {
    return false
  }
  const { program, esTreeNodeToTSNodeMap: nodeMap } = value
  return (
    isRecord(program) &&
    typeof program['getTypeChecker'] === 'function' &&
    isRecord(nodeMap) &&
    typeof nodeMap['get'] === 'function'
  )
}

/**
 * As a lib file's or a package's types. `false` without type information
 */
function hasDeclarationInOtherFile(node: Rule.Node, sourceCode: SourceCode): boolean {
  const services: unknown = sourceCode.parserServices
  if (!isTypeServices(services)) {
    return false
  }
  const tsNode = services.esTreeNodeToTSNodeMap.get(node)
  if (tsNode?.name === undefined) {
    return false
  }
  const symbol = services.program.getTypeChecker().getSymbolAtLocation(tsNode.name)
  const file = tsNode.getSourceFile()
  return symbol?.declarations?.some((declaration) => declaration.getSourceFile() !== file) ?? false
}

/**
 * A top-level interface in a script file that merges with another file's declaration, as
 * `interface Window { … }`, or in a script code block, whose other declaration is outside the excerpt
 */
function isGlobalAugmentation(node: Rule.Node, sourceCode: SourceCode, filename: string): boolean {
  return (
    node.parent?.type === 'Program' &&
    isScriptFile(sourceCode, filename) &&
    (CODE_BLOCK_FILE_REGEX.test(filename) || hasDeclarationInOtherFile(node, sourceCode))
  )
}

/**
 * Drops `consistent-type-definitions`' report where only an interface can augment. The rule is
 * report-only, since a type alias can't replace every interface, as one that refers to itself
 */
function patchTypeDefinitions(rule: Rule.RuleModule): void {
  patchCreateOnce(
    rule,
    TYPE_DEFINITIONS_PATCHED,
    (create) => (context) =>
      create(
        !hasPatchedFixes(context)
          ? context
          : withReport(context, (descriptor) => {
              const node: unknown = 'node' in descriptor ? descriptor.node : undefined
              const declaration = isRuleNode(node) ? node.parent : undefined
              if (
                declaration?.type !== ('TSInterfaceDeclaration' as string) ||
                (!isInAmbientModule(declaration) &&
                  !isGlobalAugmentation(declaration, context.sourceCode, context.filename))
              ) {
                context.report(descriptor)
              }
            }),
      ),
  )
}

/**
 * The rule objects are shared by every config in the process, such as another workspace folder's
 * in an editor, which keeps the stock rules
 */
const PATCHED_FIXES_SETTINGS_KEY = '@gpahal/patched-fixes'

export function hasPatchedFixes(context: Rule.RuleContext): boolean {
  return context.settings[PATCHED_FIXES_SETTINGS_KEY] === true
}

/**
 * Patches fixes that leave invalid code or change what the code declares, and returns the config
 * that turns the patches on in every file. `import-x/no-duplicates`' fix can race another rule's
 * without checking that it's on, so with `no-import-type-side-effects` off, such a report never
 * gets a fix
 */
export function patchUnsafeFixes(
  configs: ReadonlyArray<Pick<Linter.Config, 'plugins'>>,
  root: string,
): Array<Pick<Linter.Config, 'name' | 'settings'>> {
  for (const rule of findPatchTargets('import-x/no-duplicates', configs, root)) {
    patchDuplicateImports(rule)
  }
  for (const rule of findPatchTargets(
    '@typescript-eslint/consistent-type-definitions',
    configs,
    root,
  )) {
    patchTypeDefinitions(rule)
  }
  return [{ name: 'gpahal/fixes/patched', settings: { [PATCHED_FIXES_SETTINGS_KEY]: true } }]
}

/**
 * Calls `listeners`' first, then `onExit` after both of `Program:exit`
 */
export function mergeListeners(
  listeners: Rule.RuleListener,
  others: Rule.RuleListener,
  onExit: () => void,
): Rule.RuleListener {
  const merged: Record<string, (...args: Array<unknown>) => void> = {}
  const keys = new Set([...Object.keys(listeners), ...Object.keys(others), 'Program:exit'])
  for (const key of keys) {
    const handlers = [listeners[key], others[key]].filter(
      (handler): handler is (...args: Array<unknown>) => void => typeof handler === 'function',
    )
    merged[key] = (...args) => {
      for (const handler of handlers) {
        handler(...args)
      }
      if (key === 'Program:exit') {
        onExit()
      }
    }
  }
  return merged
}

function reportOnlySettings(
  rules: ReadonlyArray<string>,
  value: true | 'all' = true,
): NonNullable<TypedConfig['settings']> {
  return {
    [REPORT_ONLY_SETTINGS_KEY]: Object.fromEntries(rules.map((rule) => [rule, value])),
  }
}

/**
 * For `.disableRulesFix()`. ESLint merges `settings`, so it adds to the other report-only configs
 */
export function disableRulesFixConfig({
  name,
  rules,
  configs,
  root,
}: {
  name: string
  rules: ReadonlyArray<string>
  configs: ReadonlyArray<TypedConfig>
  root: string
}): TypedConfig {
  for (const ruleId of rules) {
    for (const rule of findRules(ruleId, configs, root)) {
      patchRule(rule)
    }
  }
  return { name, settings: reportOnlySettings(rules, 'all') }
}

/**
 * Once the configs are final, so a plugin that a later change adds is patched too
 */
export function patchReportOnlyRules(configs: ReadonlyArray<TypedConfig>, root: string): void {
  const ruleIds = new Set(
    configs.flatMap((config) => {
      const reportOnly: unknown = config.settings?.[REPORT_ONLY_SETTINGS_KEY]
      return isRecord(reportOnly) ? Object.keys(reportOnly) : []
    }),
  )
  for (const ruleId of ruleIds) {
    for (const rule of findRules(ruleId, configs, root)) {
      patchRule(rule)
    }
  }
}

const LIBRARY_REPORT_ONLY_CONFIG_NAME = 'gpahal/fixes/report-only-library'

/**
 * Scopes the `typescript.library` report-only config to the files of `gpahal/typescript/library`
 * as the composer's changes left them, or drops it with that config, since without files it would
 * apply everywhere
 */
export function withLibraryReportOnlyScope(
  configs: ReadonlyArray<TypedConfig>,
): Array<TypedConfig> {
  const library = configs.find((config) => config.name === LIBRARY_CONFIG_NAME)
  return configs.flatMap((config) => {
    if (config.name !== LIBRARY_REPORT_ONLY_CONFIG_NAME) {
      return [config]
    }
    if (
      config.files !== undefined ||
      config.ignores !== undefined ||
      config.basePath !== undefined
    ) {
      throw new TypeError(
        formatErrorMessage(
          [formatNames([LIBRARY_REPORT_ONLY_CONFIG_NAME])],
          `its \`files\`, \`ignores\` and \`basePath\` follow ${formatNames([LIBRARY_CONFIG_NAME])}, so a change to them would be overwritten. Override ${formatNames([LIBRARY_CONFIG_NAME])} instead`,
        ),
      )
    }
    return library
      ? {
          ...config,
          ...(library.files && { files: library.files }),
          ...(library.ignores && { ignores: library.ignores }),
          ...(library.basePath !== undefined && { basePath: library.basePath }),
        }
      : []
  })
}

/**
 * Report-only configs for fixes that can change what code does: everywhere, without type
 * information, in code blocks, in `typescript.library` files, and in an editor
 */
export function reportOnlyFixes({
  configs,
  root,
  untyped,
  isInEditor,
}: {
  configs: ReadonlyArray<TypedConfig>
  root: string
  untyped: Scope
  isInEditor: boolean
}): Array<TypedConfig> {
  const editorRules = isInEditor ? EDITOR_REPORT_ONLY_RULES : []
  const library = configs.some((config) => config.name === LIBRARY_CONFIG_NAME)
  for (const ruleId of [
    ...REPORT_ONLY_RULES,
    ...UNTYPED_REPORT_ONLY_RULES,
    ...CODE_BLOCK_REPORT_ONLY_RULES,
    ...(library ? LIBRARY_REPORT_ONLY_RULES : []),
    ...editorRules,
  ]) {
    for (const rule of findPatchTargets(ruleId, configs, root)) {
      patchRule(rule)
    }
  }
  return [
    { name: 'gpahal/fixes/report-only', settings: reportOnlySettings(REPORT_ONLY_RULES) },
    {
      name: 'gpahal/fixes/report-only-untyped',
      ...untyped,
      settings: reportOnlySettings(UNTYPED_REPORT_ONLY_RULES),
    },
    {
      name: 'gpahal/fixes/report-only-code-blocks',
      files: CODE_BLOCK_FILES,
      settings: reportOnlySettings(CODE_BLOCK_REPORT_ONLY_RULES),
    },
    ...(library
      ? [
          // Scoped by `withLibraryReportOnlyScope`, once the composer's changes are done
          {
            name: LIBRARY_REPORT_ONLY_CONFIG_NAME,
            settings: reportOnlySettings(LIBRARY_REPORT_ONLY_RULES),
          },
        ]
      : []),
    ...(isInEditor
      ? [{ name: 'gpahal/editor/settings', settings: reportOnlySettings(EDITOR_REPORT_ONLY_RULES) }]
      : []),
  ]
}
