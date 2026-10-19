import type { Linter, Rule, Scope, SourceCode } from 'eslint'
import type * as ESTree from 'estree'

import { isPlainObject, isRecord } from '@gpahal/std/objects'

import { FILENAME_CASE_IGNORES } from '@/internal/configs/constants'
import { DUPLICATE_REPORTS, type DuplicateReport } from '@/internal/duplicate-rules'
import {
  findPatchTargets,
  hasPatchedFixes,
  isOnInSettings,
  isRuleNode,
  mergeListeners,
  optionsInSettings,
  patchCreateOnce,
} from '@/internal/fixes'
import { withCompanionContext, withReport } from '@/internal/utils'

const TWIN_PATCHED = Symbol('@gpahal/eslint-config duplicate reports')

const CATCH_ERROR_NAME_PATCHED = Symbol('@gpahal/eslint-config catch-error-name of unused')

/**
 * Which of the twin's reports the kept rule's reports pair with
 */
type KeptCompanion = {
  rule: Rule.RuleModule
  match: DuplicateReport['match']
}

/**
 * From the configs that `patchDuplicateReports` last found them in
 */
const keptCompanions = new WeakMap<Rule.RuleModule, ReadonlyMap<string, KeptCompanion>>()

/**
 * As `DuplicateReport`'s `keepsFixes` says
 */
const fixKeepingTwins = new WeakSet<Rule.RuleModule>()

function rangeOf(
  descriptor: Rule.ReportDescriptor,
  sourceCode: SourceCode,
): [number, number] | undefined {
  const node: unknown = 'node' in descriptor ? descriptor.node : undefined
  const range: unknown = isRecord(node) ? node['range'] : undefined
  if (Array.isArray(range) && typeof range[0] === 'number' && typeof range[1] === 'number') {
    return [range[0], range[1]]
  }
  const loc: unknown = 'loc' in descriptor ? descriptor.loc : undefined
  if (!isRecord(loc)) {
    return undefined
  }
  const start: unknown = 'start' in loc ? loc['start'] : loc
  const end: unknown = 'end' in loc ? loc['end'] : start
  if (!isPosition(start) || !isPosition(end)) {
    return undefined
  }
  try {
    return [sourceCode.getIndexFromLoc(start), sourceCode.getIndexFromLoc(end)]
  } catch {
    return undefined
  }
}

function isPosition(value: unknown): value is { line: number; column: number } {
  return isRecord(value) && typeof value['line'] === 'number' && typeof value['column'] === 'number'
}

/**
 * As ESLint merges `meta.defaultOptions`: plain objects merge deeply, other values replace
 */
function mergeOptions(defaults: unknown, options: unknown): unknown {
  if (options === undefined) {
    return defaults
  }
  if (Array.isArray(defaults) && Array.isArray(options)) {
    return Array.from({ length: Math.max(defaults.length, options.length) }, (_, index) =>
      mergeOptions(defaults[index], options[index]),
    )
  }
  if (isPlainObject(defaults) && isPlainObject(options)) {
    return Object.fromEntries(
      Array.from(new Set([...Object.keys(defaults), ...Object.keys(options)]), (key) => [
        key,
        mergeOptions(defaults[key], options[key]),
      ]),
    )
  }
  return options
}

/**
 * Core rules such as `no-undef` read the merged options
 */
function withRuleOptions(
  context: Rule.RuleContext,
  ruleId: string,
  rule: Rule.RuleModule,
): Rule.RuleContext {
  const options = mergeOptions(rule.meta?.defaultOptions ?? [], optionsInSettings(context, ruleId))
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- `Object.create` returns `any`, and the object is the context with other `options`
  return Object.create(context, {
    options: { value: structuredClone(options), configurable: true },
  }) as Rule.RuleContext
}

function startsAfter(sorted: ReadonlyArray<[number, number]>, offset: number): number {
  let low = 0
  let high = sorted.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if ((sorted[middle]?.[0] ?? 0) <= offset) {
      low = middle + 1
    } else {
      high = middle
    }
  }
  return low
}

/**
 * Logarithmic per range, as a file can have thousands of each. Sorted by start, a running maximum
 * of ends tells whether a range lies within an earlier one, and a sparse table of minimum ends
 * whether it contains one that starts within it
 */
function createNestingIndex(
  ranges: ReadonlyArray<[number, number]>,
): (range: [number, number]) => boolean {
  const sorted = ranges.toSorted((a, b) => a[0] - b[0])
  const maxEnds: Array<number> = []
  for (const [index, [, end]] of sorted.entries()) {
    maxEnds.push(Math.max(end, maxEnds[index - 1] ?? end))
  }
  // `minEnds[level][index]` is the smallest end of the `2 ** level` ranges from `index`
  const minEnds: Array<Array<number>> = [sorted.map(([, end]) => end)]
  for (let width = 2; width <= sorted.length; width *= 2) {
    const previous = minEnds.at(-1) ?? []
    minEnds.push(
      previous
        .slice(0, sorted.length - width + 1)
        .map((end, index) => Math.min(end, previous[index + width / 2] ?? end)),
    )
  }
  const minEnd = (from: number, to: number): number => {
    const level = Math.floor(Math.log2(to - from))
    const ends = minEnds[level] ?? []
    return Math.min(ends[from] ?? Infinity, ends[to - 2 ** level] ?? Infinity)
  }
  return ([start, end]) => {
    const firstAfterStart = startsAfter(sorted, start)
    if (firstAfterStart > 0 && (maxEnds[firstAfterStart - 1] ?? -1) >= end) {
      return true
    }
    const from = startsAfter(sorted, start - 1)
    const to = startsAfter(sorted, end)
    return from < to && minEnd(from, to) <= end
  }
}

/**
 * As in `x as T` or `<T>x`
 */
function assertedTypeRangeOf(descriptor: Rule.ReportDescriptor): [number, number] | undefined {
  const node: unknown = 'node' in descriptor ? descriptor.node : undefined
  if (
    !isRecord(node) ||
    (node['type'] !== 'TSAsExpression' && node['type'] !== 'TSTypeAssertion') ||
    !isRecord(node['typeAnnotation'])
  ) {
    return undefined
  }
  const range: unknown = node['typeAnnotation']['range']
  return Array.isArray(range) && typeof range[0] === 'number' && typeof range[1] === 'number'
    ? [range[0], range[1]]
    : undefined
}

/**
 * Drops a twin's report on a node that one of its kept rules reports, where `withRulesOn` says the
 * kept rule is on. The kept rules run beside it with their options
 */
function patchTwin(rule: Rule.RuleModule): void {
  patchCreateOnce(rule, TWIN_PATCHED, (create) => (context) => {
    const kept = [...(keptCompanions.get(rule) ?? [])].filter(([ruleId]) =>
      isOnInSettings(context, ruleId),
    )
    if (kept.length === 0) {
      return create(context)
    }
    const { sourceCode } = context
    const reports: Array<Rule.ReportDescriptor> = []
    const keptRanges: Array<[number, number]> = []
    const sameKeys = new Set<string>()
    const assertedTypeKeys = new Set<string>()
    const listeners = create(
      withReport(context, (descriptor) => {
        reports.push(descriptor)
      }),
    )
    const keptListeners = kept.map(([ruleId, { rule: keptRule, match }]) =>
      keptRule.create(
        withRuleOptions(
          withCompanionContext(context, ruleId, (descriptor) => {
            const range = rangeOf(descriptor, sourceCode)
            if (!range) {
              return
            }
            if (match === 'same') {
              sameKeys.add(range.join(':'))
            } else if (match === 'asserted-type') {
              assertedTypeKeys.add(range.join(':'))
            } else {
              keptRanges.push(range)
            }
          }),
          ruleId,
          keptRule,
        ),
      ),
    )
    const companions = keptListeners.reduce<Rule.RuleListener>(
      (merged, others) => mergeListeners(merged, others, () => undefined),
      {},
    )
    return mergeListeners(listeners, companions, () => {
      const isNested = createNestingIndex(keptRanges)
      for (const descriptor of reports) {
        const range = rangeOf(descriptor, sourceCode)
        const isKept =
          range !== undefined &&
          (isNested(range) ||
            sameKeys.has(range.join(':')) ||
            assertedTypeKeys.has(assertedTypeRangeOf(descriptor)?.join(':') ?? ''))
        if (!isKept || (fixKeepingTwins.has(rule) && typeof descriptor.fix === 'function')) {
          context.report(descriptor)
        }
      }
    })
  })
}

/**
 * Drops `unicorn/catch-error-name`'s report on an unread catch binding where
 * `unicorn/prefer-optional-catch-binding`, which asks to remove it, is on
 */
function patchCatchErrorName(rule: Rule.RuleModule): void {
  patchCreateOnce(rule, CATCH_ERROR_NAME_PATCHED, (create) => (context) => {
    if (!isOnInSettings(context, 'unicorn/prefer-optional-catch-binding')) {
      return create(context)
    }
    return create(
      withReport(context, (descriptor) => {
        const node: unknown = 'node' in descriptor ? descriptor.node : undefined
        const catchClause = isRuleNode(node) ? node.parent : undefined
        if (
          isRuleNode(node) &&
          node.type === 'Identifier' &&
          catchClause?.type === 'CatchClause' &&
          catchClause.param === node
        ) {
          const variable = context.sourceCode
            .getDeclaredVariables(catchClause)
            .find(({ name }) => name === node.name)
          if (variable?.references.length === 0) {
            return
          }
        }
        context.report(descriptor)
      }),
    )
  })
}

const FILENAME_CASE_PATCHED = Symbol('@gpahal/eslint-config filename-case ignores')

/**
 * Adds `FILENAME_CASE_IGNORES` to `unicorn/filename-case`'s `ignore`, so options of yours keep
 * skipping `__tests__` and router segments
 */
function patchFilenameCase(rule: Rule.RuleModule): void {
  patchCreateOnce(rule, FILENAME_CASE_PATCHED, (create) => (context) => {
    if (!hasPatchedFixes(context)) {
      return create(context)
    }
    const [first, ...rest] = context.options as Array<unknown>
    const options: Record<string, unknown> = isRecord(first) ? first : {}
    const ignore: Array<unknown> = Array.isArray(options['ignore']) ? options['ignore'] : []
    const ignoreTexts = new Set(ignore.map(String))
    const merged = [
      ...ignore,
      ...FILENAME_CASE_IGNORES.filter((pattern) => !ignoreTexts.has(pattern)),
    ]
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- `Object.create` returns `any`, and the object is the context with other `options`
    const withIgnores = Object.create(context, {
      options: { value: [{ ...options, ignore: merged }, ...rest], configurable: true },
    }) as Rule.RuleContext
    return create(withIgnores)
  })
}

const PREFER_TERNARY_PATCHED = Symbol('@gpahal/eslint-config prefer-ternary of guard clauses')

/**
 * An `if` without `else` whose branch returns, before a `return`
 */
function isGuardClause(node: Rule.Node): boolean {
  if (node.type !== 'IfStatement' || node.alternate) {
    return false
  }
  const body =
    node.consequent.type === 'BlockStatement' && node.consequent.body.length === 1
      ? node.consequent.body[0]
      : node.consequent
  return body?.type === 'ReturnStatement'
}

/**
 * Drops `unicorn/prefer-ternary`'s report on a guard clause. Its `'only-single-line'` option still
 * reports one, and its fix can write `return value ? value : 'none'`, which other rules report
 */
function patchPreferTernary(rule: Rule.RuleModule): void {
  patchCreateOnce(rule, PREFER_TERNARY_PATCHED, (create) => (context) => {
    if (!hasPatchedFixes(context)) {
      return create(context)
    }
    return create(
      withReport(context, (descriptor) => {
        const node: unknown = 'node' in descriptor ? descriptor.node : undefined
        if (!isRuleNode(node) || !isGuardClause(node)) {
          context.report(descriptor)
        }
      }),
    )
  })
}

const MEANINGLESS_VOID_PATCHED = Symbol('@gpahal/eslint-config no-meaningless-void-operator')

/**
 * Drops `no-meaningless-void-operator`'s `meaninglessVoidOnNonCall` reports, as on
 * `void el.offsetHeight`: without `void`, `no-unused-expressions` reports the statement, and the
 * fix has no ASI check, so `record()` then `void (1 + 2)` becomes `record()(1 + 2)`
 */
function patchMeaninglessVoid(rule: Rule.RuleModule): void {
  patchCreateOnce(rule, MEANINGLESS_VOID_PATCHED, (create) => (context) => {
    if (!hasPatchedFixes(context)) {
      return create(context)
    }
    return create(
      withReport(context, (descriptor) => {
        if (!('messageId' in descriptor) || descriptor.messageId !== 'meaninglessVoidOnNonCall') {
          context.report(descriptor)
        }
      }),
    )
  })
}

const PUBLISHING_PATCHED = Symbol('@gpahal/eslint-config private package hint')

/**
 * Rules that skip `"private": true` packages, with their missing-property messages
 */
const PUBLISHING_RULES: Readonly<Record<string, ReadonlyArray<string>>> = {
  'package-json/require-exports': ['missing'],
  'package-json/require-files': ['missing'],
  'package-json/require-license': ['missing'],
  'package-json/require-repository': ['missing'],
  'package-json/require-sideEffects': ['missing'],
  'package-json/require-attribution': ['missing', 'missingContributor'],
  'package-json/require-description': ['missing'],
  'package-json/require-type': ['missing'],
}

const PRIVATE_HINT =
  'An app, which isn\'t published, sets `"private": true`, which skips this check.'

/**
 * Adds `PRIVATE_HINT` to the missing-property message, as an `npm init -y` manifest gets one
 */
function patchPublishingRule(rule: Rule.RuleModule, messageIds: ReadonlyArray<string>): void {
  patchCreateOnce(rule, PUBLISHING_PATCHED, (create) => (context) => {
    if (!hasPatchedFixes(context)) {
      return create(context)
    }
    return create(
      withReport(context, (descriptor) => {
        if (!('messageId' in descriptor) || !messageIds.includes(descriptor.messageId)) {
          context.report(descriptor)
          return
        }
        const { messageId, ...rest } = descriptor
        const message = rule.meta?.messages?.[messageId]
        context.report(
          message === undefined ? descriptor : { ...rest, message: `${message} ${PRIVATE_HINT}` },
        )
      }),
    )
  })
}

const UNVERIFIED_CERTIFICATE_PATCHED = Symbol('@gpahal/eslint-config unverified-certificate')

/**
 * Kept for the constructors and overloads the stock rule misses
 */
const UNVERIFIED_CERTIFICATE_MESSAGE =
  'Enable server certificate validation on this SSL/TLS connection.'

const TLS_MODULES: Readonly<Record<string, string>> = {
  https: 'https',
  'node:https': 'https',
  tls: 'tls',
  'node:tls': 'tls',
  undici: 'undici',
}

/**
 * The argument index and property path of the TLS options. `tls.connect`'s third argument, after a
 * port and a host, is the stock rule's
 */
const TLS_OPTION_ARGUMENTS: Readonly<
  Record<string, ReadonlyArray<{ index: number; path: ReadonlyArray<string> }>>
> = {
  'https.Agent': [{ index: 0, path: [] }],
  'tls.TLSSocket': [{ index: 1, path: [] }],
  'tls.connect': [
    { index: 0, path: [] },
    { index: 1, path: [] },
  ],
  'undici.Agent': [{ index: 0, path: ['connect'] }],
}

/**
 * The module object, without `name`, or its export `name`
 */
type ModuleBinding = { module: string; name?: string | undefined }

function findVariable(sourceCode: SourceCode, node: ESTree.Identifier): Scope.Variable | undefined {
  for (let scope: Scope.Scope | null = sourceCode.getScope(node); scope; scope = scope.upper) {
    const variable = scope.set.get(node.name)
    if (variable) {
      return variable
    }
  }
  return undefined
}

/**
 * From a string literal or a `require('…')` call of the global `require`
 */
function tlsModuleOf(
  sourceCode: SourceCode,
  node: ESTree.Node | null | undefined,
): string | undefined {
  if (node?.type === 'Literal' && typeof node.value === 'string') {
    return TLS_MODULES[node.value]
  }
  if (
    node?.type !== 'CallExpression' ||
    node.callee.type !== 'Identifier' ||
    node.callee.name !== 'require' ||
    node.arguments.length !== 1
  ) {
    return undefined
  }
  const variable = findVariable(sourceCode, node.callee)
  return variable === undefined || variable.defs.length === 0
    ? tlsModuleOf(sourceCode, node.arguments[0])
    : undefined
}

/**
 * As `a` in `{ a: 1 }` or `{ 'a': 1 }`
 */
function keyName(node: ESTree.Node): string | undefined {
  if (node.type === 'Identifier') {
    return node.name
  }
  return node.type === 'Literal' && typeof node.value === 'string' ? node.value : undefined
}

function moduleBindingOf(
  sourceCode: SourceCode,
  node: ESTree.Identifier,
): ModuleBinding | undefined {
  const [def, ...rest] = findVariable(sourceCode, node)?.defs ?? []
  if (def === undefined || rest.length > 0) {
    return undefined
  }
  if (def.type === 'ImportBinding') {
    const module = tlsModuleOf(sourceCode, def.parent.source)
    if (module === undefined) {
      return undefined
    }
    return def.node.type === 'ImportSpecifier'
      ? { module, name: keyName(def.node.imported) }
      : { module }
  }
  const module = def.type === 'Variable' ? tlsModuleOf(sourceCode, def.node.init) : undefined
  if (module === undefined || def.type !== 'Variable') {
    return undefined
  }
  const { id } = def.node
  if (id.type === 'Identifier') {
    return { module }
  }
  // In `const { Agent } = require('undici')`, `def.name` is the pattern's binding, not the call site's
  const property =
    id.type === 'ObjectPattern'
      ? id.properties.find(
          (item): item is ESTree.AssignmentProperty =>
            item.type === 'Property' && !item.computed && item.value === def.name,
        )
      : undefined
  const name = property && keyName(property.key)
  return name === undefined ? undefined : { module, name }
}

/**
 * As `https.Agent`, through an import, an imported alias or a `require()`
 */
function tlsExportOf(sourceCode: SourceCode, callee: ESTree.Node): string | undefined {
  if (callee.type === 'Identifier') {
    const binding = moduleBindingOf(sourceCode, callee)
    return binding?.name === undefined ? undefined : `${binding.module}.${binding.name}`
  }
  if (
    callee.type !== 'MemberExpression' ||
    callee.computed ||
    callee.object.type !== 'Identifier'
  ) {
    return undefined
  }
  const binding = moduleBindingOf(sourceCode, callee.object)
  const name = keyName(callee.property)
  return name === undefined || binding === undefined || binding.name !== undefined
    ? undefined
    : `${binding.module}.${name}`
}

/**
 * Through a variable of one definition that is never reassigned
 */
function objectOf(
  sourceCode: SourceCode,
  node: ESTree.Node | undefined,
): ESTree.ObjectExpression | undefined {
  if (node?.type === 'ObjectExpression') {
    return node
  }
  if (node?.type !== 'Identifier') {
    return undefined
  }
  const variable = findVariable(sourceCode, node)
  const [def, ...rest] = variable?.defs ?? []
  const writes = variable?.references.filter((reference) => reference.isWrite()) ?? []
  const init = def?.type === 'Variable' ? def.node.init : undefined
  return rest.length === 0 && writes.length <= 1 && init?.type === 'ObjectExpression'
    ? init
    : undefined
}

/**
 * Written as a key, not computed or spread
 */
function propertyValue(object: ESTree.ObjectExpression, name: string): ESTree.Node | undefined {
  const property = object.properties.findLast(
    (item): item is ESTree.Property =>
      item.type === 'Property' && !item.computed && keyName(item.key) === name,
  )
  return property?.value
}

function disablesVerification(
  sourceCode: SourceCode,
  node: ESTree.CallExpression | ESTree.NewExpression,
  { index, path }: { index: number; path: ReadonlyArray<string> },
): boolean {
  let options = objectOf(sourceCode, node.arguments[index])
  for (const key of path) {
    options &&= objectOf(sourceCode, propertyValue(options, key))
  }
  const value = options && propertyValue(options, 'rejectUnauthorized')
  return value?.type === 'Literal' && value.value === false
}

/**
 * Also reports `rejectUnauthorized: false` in `new https.Agent()`, `new tls.TLSSocket()`, undici's
 * `new Agent({ connect })` and `tls.connect()`'s options-first and path overloads. The stock rule
 * checks only `https.request()`, `request.get()` and `tls.connect(port, host, options)`
 */
function patchUnverifiedCertificate(rule: Rule.RuleModule): void {
  patchCreateOnce(rule, UNVERIFIED_CERTIFICATE_PATCHED, (create) => (context) => {
    if (!hasPatchedFixes(context)) {
      return create(context)
    }
    const { sourceCode } = context
    // A fixed stock rule would report these as well
    const reported = new Set<unknown>()
    const listeners = create(
      withReport(context, (descriptor) => {
        reported.add('node' in descriptor ? descriptor.node : undefined)
        context.report(descriptor)
      }),
    )
    const check = (node: ESTree.CallExpression | ESTree.NewExpression) => {
      const name = tlsExportOf(sourceCode, node.callee)
      if (name === undefined || (node.type === 'NewExpression') === (name === 'tls.connect')) {
        return
      }
      const isUnverified = (TLS_OPTION_ARGUMENTS[name] ?? []).some((argument) =>
        disablesVerification(sourceCode, node, argument),
      )
      if (isUnverified && !reported.has(node.callee)) {
        context.report({ node: node.callee, message: UNVERIFIED_CERTIFICATE_MESSAGE })
      }
    }
    return mergeListeners(
      listeners,
      { CallExpression: check, NewExpression: check },
      () => undefined,
    )
  })
}

/**
 * Rules change only for files whose settings say so, so a config in the same process without the
 * presets' settings gets the stock rules
 */
export function patchRuleSet(
  configs: ReadonlyArray<Pick<Linter.Config, 'plugins'>>,
  root: string,
): void {
  const twins = new Map<string, Map<string, KeptCompanion>>()
  const fixKeepingTwinIds = new Set<string>(
    DUPLICATE_REPORTS.filter(({ keepsFixes }) => keepsFixes).map(({ twin }) => twin),
  )
  for (const { kept, twin, match } of DUPLICATE_REPORTS) {
    const companions = twins.get(twin) ?? new Map<string, KeptCompanion>()
    for (const ruleId of kept) {
      const [keptRule] = findPatchTargets(ruleId, configs, root)
      if (keptRule) {
        companions.set(ruleId, { rule: keptRule, match })
      }
    }
    twins.set(twin, companions)
  }
  for (const [twin, companions] of twins) {
    for (const rule of findPatchTargets(twin, configs, root)) {
      keptCompanions.set(rule, companions)
      if (fixKeepingTwinIds.has(twin)) {
        fixKeepingTwins.add(rule)
      }
      patchTwin(rule)
    }
  }
  for (const rule of findPatchTargets('unicorn/catch-error-name', configs, root)) {
    patchCatchErrorName(rule)
  }
  for (const rule of findPatchTargets('unicorn/filename-case', configs, root)) {
    patchFilenameCase(rule)
  }
  for (const rule of findPatchTargets('unicorn/prefer-ternary', configs, root)) {
    patchPreferTernary(rule)
  }
  for (const rule of findPatchTargets(
    '@typescript-eslint/no-meaningless-void-operator',
    configs,
    root,
  )) {
    patchMeaninglessVoid(rule)
  }
  for (const rule of findPatchTargets('sonarjs/unverified-certificate', configs, root)) {
    patchUnverifiedCertificate(rule)
  }
  for (const [ruleId, messageIds] of Object.entries(PUBLISHING_RULES)) {
    for (const rule of findPatchTargets(ruleId, configs, root)) {
      patchPublishingRule(rule, messageIds)
    }
  }
}
