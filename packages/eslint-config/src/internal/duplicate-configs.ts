import { DUPLICATE_RULES, type DuplicateRule, type RuleName } from '@/internal/duplicate-rules'
import { withoutGlobFiles, type FileSpecs, type Scope } from '@/internal/globs'
import type { ResolvedOptions } from '@/internal/resolve'
import { getPlugins, isRuleOn, needsTypeInformation } from '@/internal/rules'
import type { TypedConfig, TypedRules } from '@/internal/types'

/**
 * `source` is the config that turns the kept rule on
 */
type KeptScope = Scope & { source: string | undefined }

function isSameGlobs(a: ReadonlyArray<unknown>, b: ReadonlyArray<unknown>): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * From globs alone, given both are within `codeFiles`: `outer` has the code files or each of
 * `inner`'s `files`, and its `ignores` start `inner`'s, whose others un-ignore nothing
 */
function contains(outer: Scope, inner: Scope, codeFiles: FileSpecs): boolean {
  const outerIgnores = outer.ignores ?? []
  const innerIgnores = inner.ignores ?? []
  const outerFiles = new Set(outer.files.map((file) => JSON.stringify(file)))
  return (
    (isSameGlobs(outer.files, codeFiles) ||
      inner.files.every((file) => outerFiles.has(JSON.stringify(file)))) &&
    isSameGlobs(outerIgnores, innerIgnores.slice(0, outerIgnores.length)) &&
    innerIgnores.slice(outerIgnores.length).every((glob) => !glob.startsWith('!'))
  )
}

/**
 * A scope per config that turns the rule on. A typed rule's is within `typeAware`, since
 * `disableTypeChecked` turns it off elsewhere
 */
function ruleScopes(
  configs: ReadonlyArray<TypedConfig>,
  { codeFiles, typeAware }: Pick<ResolvedOptions, 'codeFiles' | 'typeAware'>,
): Map<string, Array<KeptScope>> {
  const scopes = new Map<string, Array<KeptScope>>()
  const plugins = getPlugins(configs)
  for (const config of configs) {
    const rules = Object.entries(config.rules ?? {})
    for (const [rule, entry] of rules) {
      if (!isRuleOn(entry)) {
        continue
      }
      let ignores = config.ignores ?? []
      if (needsTypeInformation(rule, plugins)) {
        if (!typeAware) {
          continue
        }
        // The type-aware ignores' `!` globs un-ignore typed config files, not the config's own
        if (!isSameGlobs(typeAware.ignores, ignores.slice(0, typeAware.ignores.length))) {
          ignores = [...typeAware.ignores, ...ignores]
        }
      }
      const scope: KeptScope = {
        files: config.files ?? codeFiles,
        ...(ignores.length > 0 && { ignores }),
        source: config.name,
      }
      scopes.set(rule, [...(scopes.get(rule) ?? []), scope])
    }
  }
  return scopes
}

/**
 * Without a kept rule that a pair turns off where it's on, such as `sonarjs/no-redundant-jump`
 * while `unicorn/no-useless-continue` runs, and without a scope another contains
 */
function twinScopes(
  entry: DuplicateRule,
  scopes: ReadonlyMap<string, Array<KeptScope>>,
  codeFiles: FileSpecs,
): Array<KeptScope> {
  const keptScopes = entry.kept.flatMap((kept) => {
    const keptOn = scopes.get(kept) ?? []
    const keptOff = DUPLICATE_RULES.filter((other) => other.off === kept).flatMap((other) =>
      twinScopes(other, scopes, codeFiles),
    )
    return keptOn.every((scope) => keptOff.some((off) => contains(off, scope, codeFiles)))
      ? []
      : keptOn
  })
  return keptScopes.filter((scope, index) =>
    keptScopes.every(
      (other, otherIndex) =>
        !(
          otherIndex !== index &&
          contains(other, scope, codeFiles) &&
          (otherIndex < index || !contains(scope, other, codeFiles))
        ),
    ),
  )
}

/**
 * `gpahal/duplicates/rules` for code files, `gpahal/duplicates/type-aware` for typed ones, else
 * either with the kept rule's config name, as in `gpahal/duplicates/rules/antislop/sonarjs`
 */
function scopeName(
  { files, ignores = [], source }: KeptScope,
  { codeFiles, typeAware }: Pick<ResolvedOptions, 'codeFiles' | 'typeAware'>,
): string {
  const isTyped =
    typeAware !== undefined &&
    isSameGlobs(typeAware.ignores, ignores.slice(0, typeAware.ignores.length))
  const base = isTyped ? 'gpahal/duplicates/type-aware' : 'gpahal/duplicates/rules'
  const ownIgnores = isTyped ? ignores.slice(typeAware.ignores.length) : ignores
  return ownIgnores.length === 0 && isSameGlobs(files, codeFiles)
    ? base
    : `${base}/${(source ?? 'scoped').replace(/^gpahal\//u, '')}`
}

/**
 * Each list option of `testGlobs` takes its files out in turn, which stays linear, where the
 * complement of the test `files` would be the product of their entries
 */
function outsideTests(
  scope: KeptScope,
  testGlobs: ReadonlyArray<ReadonlyArray<string>>,
): KeptScope {
  return {
    ...scope,
    files: testGlobs.reduce(withoutGlobFiles, scope.files),
    source: `${scope.source ?? 'scoped'}/non-test`,
  }
}

/**
 * Turns each twin off where its kept rules run, outside test files for `staysOnInTests`. A twin
 * stays on where no config turns a kept rule on, as `unicorn/no-named-default` with
 * `imports: false`. They come before the areas' `rules`, which can turn a twin back on
 */
export function duplicateRulesConfigs(
  configs: ReadonlyArray<TypedConfig>,
  resolved: Pick<ResolvedOptions, 'codeFiles' | 'typeAware' | 'testGlobs'>,
): Array<TypedConfig> {
  const scopes = ruleScopes(configs, resolved)
  const twinsByScope = new Map<string, { scope: KeptScope; twins: Array<RuleName> }>()
  for (const entry of DUPLICATE_RULES) {
    if (!scopes.has(entry.off)) {
      continue
    }
    for (const keptScope of twinScopes(entry, scopes, resolved.codeFiles)) {
      const scope =
        entry.staysOnInTests === true ? outsideTests(keptScope, resolved.testGlobs) : keptScope
      const key = JSON.stringify([scope.files, scope.ignores ?? []])
      const group = twinsByScope.get(key) ?? { scope, twins: [] }
      group.twins.push(entry.off)
      twinsByScope.set(key, group)
    }
  }
  return Array.from(twinsByScope.values(), ({ scope, twins }) => {
    const rules: TypedRules = Object.fromEntries(twins.map((twin) => [twin, 'off']))
    return {
      name: scopeName(scope, resolved),
      files: scope.files,
      ...(scope.ignores && { ignores: scope.ignores }),
      rules,
    }
  })
}
