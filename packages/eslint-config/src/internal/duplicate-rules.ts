/**
 * The rules that report the same code. `scripts/typegen.ts`, which runs on type stripping, reads
 * `DUPLICATE_RULES`, so this module imports only types
 */

import type { TypedRules } from '@/internal/types'

export type RuleName = keyof TypedRules

/**
 * `off` is turned off where any of `kept` runs, each of which reports every case `off` does
 */
export type DuplicateRule = {
  kept: readonly [RuleName, ...Array<RuleName>]
  off: RuleName
  /**
   * The presets' exemptions turn the kept rules off in test files
   */
  staysOnInTests?: true
  reason: string
}

/**
 * The policy: ESLint core, typescript-eslint, regexp and import-x win over unicorn and sonarjs, and
 * those two and typescript-eslint over n, e18e and slop. A pair against it says why. A twin no
 * config turns on is listed to record the choice
 */
export const DUPLICATE_RULES: ReadonlyArray<DuplicateRule> = [
  {
    kept: ['import-x/no-named-default'],
    off: 'unicorn/no-named-default',
    reason: '`import { default as x }`',
  },
  {
    kept: ['@typescript-eslint/no-this-alias'],
    off: 'unicorn/no-this-assignment',
    reason: '`const self = this`. The typescript-eslint rule runs in JavaScript files too',
  },
  {
    kept: ['@typescript-eslint/no-extraneous-class'],
    off: 'unicorn/no-static-only-class',
    reason:
      'A class of only static members. The typescript-eslint rule runs in JavaScript files too',
  },
  {
    kept: ['@typescript-eslint/no-extraneous-class'],
    off: 'slop/no-static-only-class',
    reason: 'A class of only static members',
  },
  {
    kept: ['@typescript-eslint/prefer-for-of'],
    off: 'unicorn/no-for-loop',
    reason: 'A `for` loop over an array that only reads its items',
  },
  {
    kept: ['@typescript-eslint/prefer-string-starts-ends-with'],
    off: 'unicorn/prefer-string-starts-ends-with',
    reason: "`s.indexOf('a') === 0`",
  },
  {
    kept: ['@typescript-eslint/await-thenable'],
    off: 'unicorn/no-unnecessary-await',
    reason: '`await 1`',
  },
  {
    kept: ['@typescript-eslint/no-unnecessary-template-expression'],
    off: 'unicorn/no-useless-template-literals',
    reason: 'A template literal of only one string expression',
  },
  {
    kept: ['@typescript-eslint/no-unnecessary-type-conversion'],
    off: 'unicorn/no-useless-coercion',
    reason: '`String(s)` of a string',
  },
  {
    kept: ['@typescript-eslint/no-unnecessary-boolean-literal-compare'],
    off: 'unicorn/no-unnecessary-boolean-comparison',
    reason: '`isOn === true` of a boolean',
  },
  {
    kept: ['@typescript-eslint/no-implied-eval'],
    off: 'no-implied-eval',
    reason:
      "`setTimeout('code')`. The core rule runs where there's no type information, in `gpahal/typescript/untyped-core-rules`",
  },
  {
    kept: ['@typescript-eslint/only-throw-error'],
    off: 'no-throw-literal',
    reason: "`throw 'text'`. The core rule runs where there's no type information, as above",
  },
  {
    kept: ['@typescript-eslint/prefer-promise-reject-errors'],
    off: 'prefer-promise-reject-errors',
    reason: "`reject('text')`. The core rule runs where there's no type information, as above",
  },
  {
    kept: ['@typescript-eslint/dot-notation'],
    off: 'dot-notation',
    reason:
      "`object['key']`. The core rule runs in JavaScript files without type information, in `gpahal/typescript/untyped-javascript-core-rules`",
  },
  {
    kept: ['@typescript-eslint/default-param-last'],
    off: 'default-param-last',
    reason:
      "`function f(a = 1, b) {}`. The typescript-eslint rule runs in JavaScript files too, and also reports an optional parameter before a required one. The core rule runs in a JavaScript-only project's JavaScript files",
  },
  {
    kept: ['@typescript-eslint/no-non-null-assertion'],
    off: '@typescript-eslint/non-nullable-type-assertion-style',
    staysOnInTests: true,
    reason:
      '`params.id as string` of a `string | undefined`, which the style rule fixes to `params.id!`, which the kept rule reports. In test files, where non-null assertions are allowed, the style rule stays on',
  },
  {
    kept: ['@typescript-eslint/no-confusing-void-expression'],
    off: 'sonarjs/no-use-of-empty-return-value',
    reason: 'The value of a call that returns nothing',
  },
  {
    kept: ['unicorn/new-for-builtins'],
    off: 'no-new-wrappers',
    reason:
      "`new String('a')`. Against the policy, since the unicorn rule also requires `new` for `Map`, `Date` and others",
  },
  {
    kept: ['regexp/no-misleading-unicode-character'],
    off: 'no-misleading-character-class',
    reason:
      'An emoji in a character class without the `u` flag. Against the policy, since the regexp rule has a fix',
  },
  {
    kept: ['@typescript-eslint/strict-void-return'],
    off: 'no-promise-executor-return',
    reason:
      'A value returned from a promise executor. The typescript-eslint rule runs only in files with type information, and no preset turns it on',
  },
  {
    kept: ['sonarjs/no-ignored-return'],
    off: 'unicorn/no-unused-builtin-method-return',
    reason: '`[1].map(f)` as a statement',
  },
  {
    kept: ['unicorn/prefer-boolean-return'],
    off: 'sonarjs/prefer-single-boolean-return',
    reason:
      '`if (c) return true; return false`. Against the policy, since unicorn is on by default and has a fix',
  },
  {
    kept: ['unicorn/no-useless-continue'],
    off: 'sonarjs/no-redundant-jump',
    reason:
      'A loop ending in `continue`. Against the policy, as above. `no-useless-return` then reports a redundant `return`',
  },
  {
    kept: ['sonarjs/no-redundant-jump'],
    off: 'no-useless-return',
    reason:
      'A function ending in `return`, while the SonarJS rule runs, which also covers `continue`',
  },
  {
    kept: ['no-useless-assignment'],
    off: 'sonarjs/no-dead-store',
    reason: 'A value assigned and never read',
  },
  {
    kept: ['for-direction'],
    off: 'sonarjs/for-loop-increment-sign',
    reason: 'A `for` loop counting away from its end',
  },
  {
    kept: ['unicorn/no-impossible-length-comparison'],
    off: 'sonarjs/no-collection-size-mischeck',
    reason: '`values.length < 0`',
  },
  {
    kept: ['unicorn/no-lonely-if'],
    off: 'sonarjs/no-collapsible-if',
    reason: 'An `if` that is the only statement of another',
  },
  {
    kept: ['no-dupe-else-if'],
    off: 'sonarjs/no-identical-conditions',
    reason: "An `else if` with an earlier branch's condition",
  },
  {
    kept: ['unicorn/no-process-exit'],
    off: 'n/no-process-exit',
    reason: '`process.exit()`. The unicorn rule allows it in command-line tools',
  },
  {
    kept: ['unicorn/prefer-at'],
    off: 'e18e/prefer-array-at',
    reason: '`values[values.length - 1]`',
  },
  {
    kept: ['unicorn/prefer-array-some'],
    off: 'e18e/prefer-array-some',
    reason: '`values.find(f) !== undefined`',
  },
  {
    kept: ['unicorn/prefer-date-now'],
    off: 'e18e/prefer-date-now',
    reason: '`new Date().getTime()`',
  },
  {
    kept: ['unicorn/prefer-includes', '@typescript-eslint/prefer-includes'],
    off: 'e18e/prefer-includes',
    reason:
      '`values.indexOf(value) !== -1`. typescript-eslint keeps it with `unicorn: false` in files with type information',
  },
  {
    kept: ['unicorn/prefer-regexp-test'],
    off: 'e18e/prefer-regex-test',
    reason: '`s.match(/a/)` as a condition',
  },
  {
    kept: ['unicorn/prefer-url-can-parse'],
    off: 'e18e/prefer-url-canparse',
    reason: '`new URL(s)` in a `try` to check it',
  },
  {
    kept: ['@typescript-eslint/strict-boolean-expressions'],
    off: 'unicorn/explicit-length-check',
    reason:
      "`if (xs.length)` and `xs.length ? a : b`. The unicorn rule runs where there's no type information, and only reports. Its other reports, such as `xs.length >= 1` for `xs.length > 0`, are style",
  },
  {
    kept: ['@typescript-eslint/no-unnecessary-condition'],
    off: 'sonarjs/different-types-comparison',
    reason:
      '`value === undefined` where `value: number`. TypeScript reports a comparison of types without overlap that the typescript-eslint rule leaves, such as `value === "a"`',
  },
  {
    kept: ['unicorn/no-abusive-eslint-disable'],
    off: '@eslint-community/eslint-comments/no-unlimited-disable',
    reason: 'An `eslint-disable` comment without rules',
  },
  {
    kept: [
      '@eslint-react/no-nested-component-definitions',
      '@eslint-react/no-nested-lazy-component-declarations',
    ],
    off: 'react-hooks/static-components',
    reason:
      'A component defined during render, such as a nested function or a `lazy()` call. The React Compiler rule misses a nested component used only in a callback, such as `items.map()`, and alone reports one returned by another call, such as `const C = make()`',
  },
]

/**
 * Neither covers every case of the other, so both stay on, and a twin's report that `match` pairs
 * with a kept rule's is dropped where the kept rule is on
 */
export type DuplicateReport = {
  kept: readonly [RuleName, ...Array<RuleName>]
  twin: RuleName
  /**
   * By default, a twin report whose node contains or lies within the kept one's, as for a call and
   * its callee. `same`: the same node, for rules that also report nested nodes, as the inner `id!`
   * of `users.get(id!)?.name!`. `asserted-type`: an assertion whose type is the kept node, as in
   * `x as any`
   */
  match?: 'same' | 'asserted-type'
  reason: string
}

/**
 * The kept rules run beside their twins without options, so their reports don't depend on them.
 * Twin reports are sent on the merged `Program:exit`, so a twin that reports later, as from
 * `onCodePathEnd`, would lose them
 */
export const DUPLICATE_REPORTS: ReadonlyArray<DuplicateReport> = [
  {
    kept: ['@typescript-eslint/no-empty-object-type'],
    twin: '@typescript-eslint/consistent-type-definitions',
    reason:
      '`interface A extends B {}`, which is `B` or `type A = B`, as `no-empty-object-type` suggests',
  },
  {
    kept: ['unicorn/prefer-top-level-await', 'vitest/valid-expect'],
    twin: '@typescript-eslint/no-floating-promises',
    reason:
      'A top-level `main()` in an ES module, which `await main()` fixes for both, and `expect(p).resolves.toBe(1)` without `await`, whose `await` the vitest rule adds',
  },
  {
    kept: ['unicorn/no-new-buffer'],
    twin: 'n/no-deprecated-api',
    reason:
      '`new Buffer(10)`, with `node`, where the unicorn rule names `Buffer.alloc()` and `Buffer.from()`. Only the n rule reports the other deprecated APIs, such as `url.parse()`',
  },
  {
    kept: ['@gpahal/no-browser-globals'],
    twin: 'n/no-unsupported-features/node-builtins',
    reason:
      '`localStorage` in `server` files, with `node`, where the own rule says that server code runs without browser globals. Only the n rule reports a built-in that the supported Node versions lack',
  },
  {
    kept: ['@gpahal/no-browser-globals'],
    twin: 'unicorn/prefer-global-this',
    reason:
      "`window` and `self` in `server` files, where the own rule says that server code runs without browser globals, and the unicorn rule's `globalThis.location` would still be one. Only the unicorn rule reports `global`",
  },
  {
    kept: ['@typescript-eslint/prefer-nullish-coalescing'],
    twin: 'unicorn/prefer-logical-operator-over-ternary',
    reason:
      "`x == null ? '' : x`, where the unicorn rule asks for `||`, which also replaces `0` and `''`",
  },
  {
    kept: ['unicorn/prefer-string-trim-start-end', 'unicorn/prefer-string-slice'],
    twin: '@typescript-eslint/no-deprecated',
    reason: '`s.trimLeft()` and `s.substr(1)`, where the unicorn rules name the replacement',
  },
  {
    kept: ['prefer-template'],
    twin: '@typescript-eslint/restrict-plus-operands',
    reason: "`'n=' + n`, which a template literal fixes for both",
  },
  {
    kept: ['unicorn/no-useless-coercion', '@typescript-eslint/no-unnecessary-type-conversion'],
    twin: 'prefer-template',
    reason: "`String(x) + ''`, whose `+ ''` goes",
  },
  {
    kept: ['@eslint-react/dom-no-script-url'],
    twin: 'no-script-url',
    reason:
      '`href="javascript:…"` in JSX. Only the core rule reports a script URL outside JSX, such as `location.href = \'javascript:…\'`',
  },
  {
    kept: ['@eslint-react/dom-no-script-url'],
    twin: 'jsx-a11y-x/anchor-is-valid',
    reason: '`<a href="javascript:…">`. Only the jsx-a11y rule reports `href="#"`',
  },
  {
    kept: ['@eslint-react/no-leaked-conditional-rendering'],
    twin: '@typescript-eslint/strict-boolean-expressions',
    reason: '`{count && <X />}`, where the React rule says what renders',
  },
  {
    kept: ['@gpahal/no-unstrippable-syntax'],
    twin: '@typescript-eslint/no-namespace',
    reason:
      "A namespace with values, with `node: { typeStripping: true }`, where the own rule says why Node can't run it",
  },
  {
    kept: ['no-undef'],
    twin: '@typescript-eslint/no-require-imports',
    reason: '`require()` in an ES module `.js` file, where `require` is undefined',
  },
  {
    kept: ['regexp/no-useless-escape'],
    twin: 'no-useless-escape',
    reason: '`/[a\\.]/`. Only the core rule reports strings and templates',
  },
  {
    kept: ['@typescript-eslint/prefer-includes'],
    twin: 'unicorn/prefer-includes',
    reason:
      '`values.indexOf(value) !== -1`, which the typescript-eslint rule reports only for a type with `includes`',
  },
  {
    kept: ['@typescript-eslint/prefer-find'],
    twin: 'unicorn/prefer-array-find',
    reason:
      '`values.filter(f)[0]`, which the typescript-eslint rule reports only for an array type',
  },
  {
    kept: ['import-x/no-anonymous-default-export'],
    twin: 'unicorn/no-anonymous-default-export',
    reason: '`export default function () {}`',
  },
  {
    kept: ['@typescript-eslint/no-explicit-any'],
    twin: '@typescript-eslint/no-unsafe-type-assertion',
    match: 'asserted-type',
    reason:
      '`x as any` and `<any>x`, where a disable comment for `no-explicit-any` covers both. Only the twin reports an assertion to a narrower type',
  },
  {
    kept: ['@typescript-eslint/adjacent-overload-signatures'],
    twin: 'grouped-accessor-pairs',
    match: 'same',
    reason:
      "A class's getter and setter of one name apart. Only the core rule reports them in an object literal",
  },
  {
    kept: ['unicorn/throw-new-error', 'no-object-constructor'],
    twin: 'unicorn/new-for-builtins',
    match: 'same',
    reason:
      "`throw Error('x')`, and `Object()`, where the unicorn rule asks for `new Object()`, which the core rule reports too. Only the twin reports a call of another builtin, such as `Map()`",
  },
  {
    kept: ['@typescript-eslint/no-non-null-asserted-optional-chain'],
    twin: '@typescript-eslint/no-non-null-assertion',
    match: 'same',
    reason: '`a?.b!`. Only the twin reports a non-null assertion without an optional chain',
  },
]

/**
 * Each pair for a reason
 */
export const ALLOWED_OVERLAPS: ReadonlyArray<{
  rules: readonly [RuleName, RuleName]
  reason: string
}> = [
  {
    rules: ['no-prototype-builtins', 'e18e/prefer-object-has-own'],
    reason:
      '`obj.hasOwnProperty(key)`. Neither covers the other: the core rule also reports `isPrototypeOf` and `propertyIsEnumerable`, and the e18e rule `Object.prototype.hasOwnProperty.call()`. Neither fixes it here: the e18e rule is report-only',
  },
  {
    rules: ['import-x/no-anonymous-default-export', 'unicorn/no-anonymous-default-export'],
    reason:
      '`export default function () {}`, which `DUPLICATE_REPORTS` reports once. Only the import-x rule reports `export default {}`, and only the unicorn rule `module.exports = function () {}` in CommonJS',
  },
  {
    rules: ['import-x/no-extraneous-dependencies', 'n/no-extraneous-import'],
    reason:
      'An import of an undeclared package, with `node`. Only the n rule reports an `import type` of one',
  },
  {
    rules: ['import-x/no-extraneous-dependencies', 'n/no-extraneous-require'],
    reason:
      "A `require()` of an undeclared package, with `node`. Only the n rule reports `require.resolve('pkg')` of one",
  },
  {
    rules: ['import-x/no-extraneous-dependencies', 'n/no-unpublished-require'],
    reason:
      'A `require()` in published code of a package that only development installs, with `node`. Only the n rule reports a `require()` of a file that the `files` of `package.json` leave out, such as `require(\'../scripts/h.js\')` in `src/a.cjs` with `"files": ["src"]`',
  },
  {
    rules: ['no-useless-escape', 'regexp/no-useless-escape'],
    reason:
      "`/[a\\.]/`, which `DUPLICATE_REPORTS` reports once. Only the core rule reports strings and templates, and only the regexp rule a pattern in a string, such as `new RegExp('[a\\\\.]', flags)`",
  },
  {
    rules: ['sonarjs/no-duplicated-branches', 'unicorn/no-duplicate-if-branches'],
    reason:
      'Two `if` branches with the same code, as in `if (a) { f() } else if (b) { f() }`. Only the SonarJS rule reports `switch` cases, and only the unicorn rule a chain of one-line branches that ends in `else`, as in `if (a) { f(1) } else if (b) { f(1) } else { f(0) }`',
  },
  {
    rules: ['no-constant-condition', '@typescript-eslint/no-unnecessary-condition'],
    reason: '`if (true)`, which the core rule reports in every file',
  },
  {
    rules: ['unicorn/prefer-includes', '@typescript-eslint/prefer-includes'],
    reason:
      '`values.indexOf(value) !== -1`, which `DUPLICATE_REPORTS` reports once. Only the unicorn rule reports `values.some((item) => item === value)`',
  },
  {
    rules: ['unicorn/prefer-array-find', '@typescript-eslint/prefer-find'],
    reason:
      '`values.filter(f)[0]`, which `DUPLICATE_REPORTS` reports once. Only the unicorn rule reports `const [first] = values.filter(f)` and `values.filter(f).shift()`',
  },
  {
    rules: ['no-new-func', '@typescript-eslint/no-implied-eval'],
    reason:
      '`new Function()`. Only the core rule reports `Function.call()`, `Function.apply()` and `Function.bind()` with a string',
  },
  {
    rules: ['sonarjs/no-weak-cipher', 'sonarjs/encryption-secure-mode'],
    reason:
      "`createCipheriv('des-ecb', …)`, a weak cipher in an insecure mode. Each names one of the two weaknesses, and fixing one leaves the other",
  },
  {
    rules: ['sonarjs/no-identical-expressions', 'unicorn/no-duplicate-logical-operands'],
    reason:
      '`a && a`. Only the SonarJS rule reports the other operators, such as `a - a` and `a / a`',
  },
  {
    rules: ['sonarjs/no-gratuitous-expressions', '@typescript-eslint/no-unnecessary-condition'],
    reason:
      "An inner `if (x)` inside `if (x)`. Only the SonarJS rule reports it where narrowing leaves `x`'s type able to be falsy, such as `string | undefined` narrowed to `string`",
  },
]
