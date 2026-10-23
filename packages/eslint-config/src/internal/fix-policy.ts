/**
 * Rules whose fix can change what code does and can't be turned off, so they report without fixing
 * everywhere. From an audit of every enabled rule's fixer; each entry's comment says what its fix
 * would change. The audit kept these fixing, since they change code on purpose:
 *
 * - `regexp/no-missing-g-flag` adds the `g` that `replaceAll` and `matchAll` need
 * - `vitest/valid-expect`, `playwright/missing-playwright-await` and `storybook/await-interactions`
 *   add the `await` an asynchronous assertion or interaction needs
 * - `jsdoc/no-defaults` changes only the docs
 */
export const REPORT_ONLY_RULES: ReadonlyArray<string> = [
  // Code and timing
  '@typescript-eslint/consistent-indexed-object-style', // a type alias can't merge with another declaration
  '@typescript-eslint/no-array-constructor', // `new Array(...a)` of one number is sparse
  '@typescript-eslint/no-confusing-void-expression', // `return a || f()` returns `a`, which the fix drops
  '@typescript-eslint/no-meaningless-void-operator', // without semicolons, the line joins the one before
  '@typescript-eslint/prefer-function-type', // a type alias can't merge with another declaration
  '@typescript-eslint/prefer-includes', // `includes` finds `NaN`
  '@typescript-eslint/prefer-optional-chain', // a repeated call or getter runs once
  '@typescript-eslint/prefer-string-starts-ends-with', // `lastIndexOf` of a longer string
  '@typescript-eslint/promise-function-async', // a synchronous `throw` becomes a rejection
  '@typescript-eslint/return-await', // `return p` settles a tick later than `return await p`
  'e18e/prefer-array-from-map', // maps what the mapper adds, and drops its third argument
  'e18e/prefer-array-some', // `find` returns the element, which can be falsy
  'e18e/prefer-date-now', // a shadowed `Date`, such as an imported date class, may lack `now`
  'e18e/prefer-includes', // `includes` finds `NaN`
  'e18e/prefer-object-has-own', // a shadowed `Object`, and `o?.hasOwnProperty(k)` without an object
  'e18e/prefer-regex-test', // `test` moves a global regex's `lastIndex`
  'e18e/prefer-spread-syntax', // `Object.assign` and `__proto__`, `concat` of non-arrays
  'e18e/prefer-timer-args', // reads the arguments when the timer is scheduled
  'import-x/first', // moves an import above code that runs before it under CommonJS output
  'import-x/no-absolute-path', // bundlers resolve `/src` from the project root
  'import-x/no-relative-packages', // the package import resolves through `exports`, which may not expose the file, or to another installed copy
  'n/hashbang', // deletes the shebang of a script that `bin` doesn't list
  'no-extra-bind', // a bound function's `name` is `bound …` and it has no `prototype`
  'object-shorthand', // a method can't be called with `new`
  'prefer-object-spread', // `Object.assign` sets the prototype from an own `__proto__` key, and spread copies it as a key
  'prefer-template', // a template literal calls `toString` where `+` calls `valueOf`
  'unicorn/consistent-boolean-name', // renames an Astro shorthand attribute such as `{open}`, which changes the prop it passes
  'unicorn/dom-node-dataset', // an element of an XML document has no `dataset`
  'unicorn/escape-case', // `\u{…}` without the `u` flag is literal text
  'unicorn/explicit-length-check', // a missing `size` is falsy but not `0`
  'unicorn/name-replacements', // renames an Astro shorthand attribute such as `{btn}`, which changes the prop it passes
  'unicorn/new-for-builtins', // `RegExp(re)` returns `re`, and `new RegExp(re)` a copy
  'unicorn/no-array-reduce', // `reduce` throws for an empty array without an initial value, and the loop doesn't
  'unicorn/no-console-spaces', // changes what's logged
  'unicorn/no-declarations-before-early-exit', // a hoisted function reads the moved variable
  'unicorn/no-for-each', // `forEach` skips holes and items the callback adds, and `for…of` visits them
  'unicorn/no-for-loop', // indexing a string visits UTF-16 code units, and `for…of` code points
  'unicorn/no-immediate-mutation', // `Object.assign` and `__proto__`, setters
  'unicorn/no-incorrect-query-selector', // a missing element is `null` rather than `undefined`
  'unicorn/no-instanceof-builtins', // `Array.isArray` is `true` across realms
  'unicorn/no-invalid-url-protocol-comparison', // runs a branch whose comparison was always false
  'unicorn/no-invalid-well-known-symbol-methods', // renames the method its callers use
  'unicorn/no-named-default', // `export { x as default }` exports the binding, and `export default x` its value then
  'unicorn/no-new-array', // a shadowed `Array`, such as an imported class, isn't the built-in an array literal makes
  'unicorn/no-redundant-comparison', // removes a comparison that guards a call
  'unicorn/no-selector-as-dom-name', // changes the class or id used
  'unicorn/no-single-promise-in-promise-methods', // `Promise.any` rejects with an `AggregateError`
  'unicorn/no-static-only-class', // static methods become enumerable
  'unicorn/no-unnecessary-await', // the function's promise settles a microtask sooner
  'unicorn/no-unnecessary-global-this', // a missing global throws without `globalThis.`
  'unicorn/no-unnecessary-splice', // `.length = 0` skips a reactive array's `splice`
  'unicorn/no-useless-else', // `process.exit()` counts as an exit, but a test's stub of it returns and the moved code runs
  'unicorn/no-useless-iterator-to-array', // a `toArray()` that isn't an iterator's, on an object that isn't iterable
  'unicorn/no-useless-override', // the parent gets the arguments the override dropped
  'unicorn/no-useless-promise-resolve-reject', // the callback's promise settles sooner
  'unicorn/no-useless-spread', // iterating directly sees what the loop adds
  'unicorn/no-useless-undefined', // `arguments.length` counts an `undefined` argument
  'unicorn/prefer-add-event-listener', // adds a listener on each call rather than replacing it
  'unicorn/prefer-aggregate-error', // changes the error's class
  'unicorn/prefer-array-find', // the predicate runs fewer times
  'unicorn/prefer-array-flat', // `.flat()` drops holes
  'unicorn/prefer-array-flat-map', // flattens between mapper calls
  'unicorn/prefer-array-from-range', // a fractional length no longer throws
  'unicorn/prefer-array-index-of', // `indexOf` skips holes, and reads the value once, also for `[]`
  'unicorn/prefer-array-some', // the predicate runs fewer times
  'unicorn/prefer-block-statement-over-iife', // a block can't reuse an outer label's name
  'unicorn/prefer-classlist-toggle', // `toggle(name, undefined)` toggles the class, where the `if` removes it
  'unicorn/prefer-dom-node-html-methods', // `getHTML` is newer than `innerHTML`
  'unicorn/prefer-dom-node-replace-children', // `innerHTML = ''` empties a `<template>`'s `content`, which `replaceChildren()` leaves
  'unicorn/prefer-export-from', // the re-export loads after the other imports
  'unicorn/prefer-get-or-insert-computed', // the default's side effects run only for a new key
  'unicorn/prefer-global-this', // `globalThis` exists where `window` throws
  'unicorn/prefer-group-by', // `Object.groupBy` returns an object without a prototype
  'unicorn/prefer-https', // changes URLs, including identifiers such as schema ids
  'unicorn/prefer-includes', // `includes` finds `NaN`
  'unicorn/prefer-keyboard-event-key', // an event object with only `keyCode`, such as a test's, has no `key`
  'unicorn/prefer-location-assign', // a stub `location` without `assign`, and `assign` throws a `SyntaxError` where the setter throws a `TypeError`
  'unicorn/prefer-math-min-max', // `<` compares strings as text
  'unicorn/prefer-modern-math-apis', // rounding of `Math.log(n) / Math.LN10`
  'unicorn/prefer-native-coercion-functions', // the function's `name` becomes the built-in's, and `new` no longer throws
  'unicorn/prefer-negative-index', // `slice(a.length - 3)` of a shorter array keeps fewer items than `slice(-3)`
  'unicorn/prefer-object-define-properties', // a later descriptor reads an earlier property
  'unicorn/prefer-object-from-entries', // `object[key] = value` with the key `__proto__` sets the prototype, and `Object.fromEntries` adds a property
  'unicorn/prefer-object-iterable-methods', // `Object.values` snapshots the values
  'unicorn/prefer-private-class-fields', // other modules and proxies lose the field
  'unicorn/prefer-query-selector', // `getElementsBy*` is live and `querySelectorAll` static
  'unicorn/prefer-promise-static-methods', // `Promise.resolve(p)` returns the promise `p` itself, which settles sooner than one that adopts it
  'unicorn/prefer-queue-microtask', // `nextTick` runs before promise jobs
  'unicorn/prefer-response-static-json', // the content type, and `undefined` throws
  'unicorn/prefer-set-has', // a `Set` copies an array that `sort` returns in place
  'unicorn/prefer-single-call', // the second call's arguments are read before the first call
  'unicorn/prefer-spread', // `.slice()` of a typed array or string
  'unicorn/prefer-string-pad-start-end', // `repeat` throws for a longer string, `padStart` doesn't
  'unicorn/prefer-type-error', // changes the error's class
  'unicorn/require-css-escape', // escapes an escaped value again, and `CSS` is missing in Node
  'unicorn/require-number-to-fixed-digits-argument', // decimal libraries' `toFixed()` doesn't round
  // Regexes
  'regexp/control-character-escape', // `\x00` before a digit becomes an octal escape
  'regexp/no-dupe-characters-character-class', // with `i`, drops `A-Z` from `[a-zA-Z]`, which a `.source` spliced into a pattern without `i` needs
  'regexp/no-trivially-nested-quantifier', // the outer repeat resets a capture inside, so `(?:(a)?){2}` leaves it unset where `(a){0,2}` captures
  'regexp/no-useless-character-class', // an escape valid only in a class
  'regexp/no-useless-flag', // the flags are passed on with `.flags`
  'regexp/no-useless-lazy', // `.+?\n` and `.+\n` differ in a pattern with `s` that splices in its `.source`
  'regexp/no-useless-non-capturing-group', // a quantified assertion
  'regexp/no-useless-set-operand', // leaves `^` first in a class
  'regexp/no-useless-string-literal', // V8 doesn't case-fold a one-character `\q{…}`
  'regexp/optimal-quantifier-concatenation', // across a lookaround's boundary
  'regexp/prefer-character-class', // a `.source` spliced into another pattern
  'regexp/prefer-predefined-assertion', // a `.source` spliced into a pattern with `m`, where `$` matches at each line end
  'regexp/prefer-question-quantifier', // an empty alternative left in the group
  'regexp/prefer-set-operation', // `.` in a class is a literal dot
  'regexp/prefer-unicode-codepoint-escapes', // a `.source` spliced into a pattern without `u` reads `\u{1f600}` as the text `u{1f600}`
  'regexp/prefer-w', // with `i`, `[a-z0-9_]` becomes `\w`, which a `.source` spliced into a pattern without `i` widens
  'regexp/strict', // an identity escape merges with the escape before it
  'regexp/use-ignore-case', // a `.source` spliced into a pattern without `i`
  // Comments, tests and frameworks
  '@eslint-react/dom-no-hydrate', // a concurrent root, without the callback
  '@eslint-react/dom-no-render', // a concurrent root, without the callback or return value
  '@eslint-react/dom-no-use-form-state', // a second import of `useActionState`
  '@eslint-react/no-component-will-mount', // leaves the calls of the renamed method
  '@eslint-react/no-component-will-receive-props', // leaves the calls of the renamed method
  '@eslint-react/no-component-will-update', // leaves the calls of the renamed method
  '@eslint-react/rsc-function-definition', // a server action's callers in its file get a promise
  'astro/no-deprecated-astro-fetchcontent', // `Astro.glob` returns a promise of modules
  'better-tailwindcss/enforce-canonical-classes', // `w-[1rem]` becomes `w-4`, which follows `--spacing`
  'better-tailwindcss/enforce-consistent-class-order', // tailwind-merge resolves by position
  'better-tailwindcss/enforce-consistent-line-wrapping', // wraps a class string into a template literal, whose newlines `split(' ')` keeps
  'better-tailwindcss/no-deprecated-classes', // `rounded-sm` follows the theme, `rounded` doesn't
  'better-tailwindcss/no-duplicate-classes', // a CSS string in a variable named `style`
  'better-tailwindcss/no-unnecessary-whitespace', // a template literal's or concatenation's space can separate classes
  'jsdoc/check-tag-names', // removes tags, such as `@readonly`, that TypeDoc reads
  'jsdoc/empty-tags', // deletes the text after a tag such as `@private`
  'jsdoc/no-multi-asterisks', // strips the `**` of bold text that starts a line
  'playwright/no-unsafe-references', // the page's global of the name becomes the test's value
  'playwright/no-useless-await', // removes a microtask
  'playwright/prefer-to-have-count', // waits for the count, where the test checks it at once
  'playwright/prefer-to-have-length', // `.not.toBe(0)` passes for a `length` that's `undefined`, `.not.toHaveLength(0)` fails
  'playwright/prefer-web-first-assertions', // waits for the state, where the test checks it at once
  'playwright/valid-title', // renaming a test orphans its snapshots
  'storybook/default-exports', // Storybook indexes the file under a title from its path
  'storybook/hierarchy-separator', // changes the stories' ids and URLs
  'storybook/use-storybook-testing-library', // `storybook/test`'s functions are instrumented
  'vitest/consistent-test-it', // renames `test` to an `it` that isn't imported
  'vitest/no-import-node-test', // `node:test`'s API isn't Vitest's
  'vitest/no-unneeded-async-expect-function', // a synchronous throw is no longer a rejection
  'vitest/prefer-called-exactly-once-with', // moves the assertion before the call it checks
  'vitest/prefer-to-be', // `.not.toEqual(undefined)` becomes `.toBeUndefined()` in two passes
  'vitest/valid-title', // renaming a test orphans its snapshot
  // Markdown, JSON and HTML
  '@html-eslint/no-redundant-role', // `ul[role='list']` restores the list semantics Safari drops, and CSS selects it
  '@html-eslint/require-button-type', // `type="submit"` submits the form a toggle button is in
  'json/no-unnormalized-keys', // a lookup by the original key misses
  'markdown-preferences/definitions-last', // turns adjacent definitions into paragraph text
  'markdown-preferences/emoji-notation', // `a:x:b` becomes `a❌b`
  'markdown-preferences/hard-linebreak-style', // a backslash before the break escapes it
  'markdown-preferences/level1-heading-style', // a trailing ` #` becomes a closing sequence
  'markdown-preferences/level2-heading-style', // a trailing ` ##` becomes a closing sequence
  'markdown-preferences/ordered-list-marker-sequence', // a wider marker moves the item's content column and code blocks
  'markdown-preferences/ordered-list-marker-start', // a narrower marker moves the item's content column and code blocks
  'markdown-preferences/prefer-fenced-code-blocks', // a fence in the code closes the block early
  'markdown-preferences/prefer-link-reference-definitions', // one definition for links that differ
  'markdown-preferences/sort-definitions', // the first of two duplicate labels wins
  'markdown/no-reference-like-urls', // a relative link becomes the definition's URL
  'markdown/no-space-in-emphasis', // `2 * 3 * 4` becomes `2 *3* 4`, which italicises the 3
  'package-json/repository-shorthand', // garbles an scp-style URL
  'package-json/require-type', // `commonjs` turns off Node's ES module syntax detection
  'package-json/valid-author', // writes the git user of whoever runs the lint
]

/**
 * Fixes that can change code in ways the type checker reports, as for an array-like without `at`,
 * so they report only in files without type information. `consistent-type-imports` needs type
 * information to see `emitDecoratorMetadata`
 */
export const UNTYPED_REPORT_ONLY_RULES: ReadonlyArray<string> = [
  '@typescript-eslint/consistent-type-imports', // `emitDecoratorMetadata` needs the value import
  'e18e/prefer-array-at', // an array-like without `at`
  'unicorn/consistent-date-clone', // `new Date(x)` of a non-`Date` with a `getTime`
  'unicorn/no-array-method-this-argument', // a stream's `map` options in a variable
  'unicorn/no-await-expression-member', // `[x] = v` iterates where `v[0]` indexes: a `Set` or an array-like without an iterator
  'unicorn/no-new-buffer', // `Buffer` may be another class, such as a WebGL library's, without Node's `from`
  'unicorn/no-unnecessary-string-trim', // a zod schema's `trim()`
  'unicorn/no-unreadable-array-destructuring', // indexing a `Set` or another iterable
  'unicorn/no-useless-coercion', // any `.length` counts as a number, but an object's, such as parsed JSON's, can be a string
  'unicorn/prefer-array-from-async', // `Array.fromAsync` is ES2024
  'unicorn/prefer-at', // an array-like without `at`
  'unicorn/prefer-class-fields', // a field named `__proto__` is a property, and assigning it sets the prototype
  'unicorn/prefer-dom-node-append', // an `appendChild` that isn't the DOM's
  'unicorn/prefer-dom-node-remove', // a `removeChild` that isn't the DOM's
  'unicorn/prefer-iterable-in-constructor', // `new Map` throws for entries the loop destructures
  'unicorn/prefer-modern-dom-apis', // `insertBefore` with a `null` reference
  'unicorn/prefer-promise-try', // `Promise.try` is ES2025
  'unicorn/prefer-promise-with-resolvers', // `Promise.withResolvers` is ES2024
  'unicorn/prefer-prototype-methods', // a shadowed `Array` or `Object`, such as Effect's `Array` module
  'unicorn/prefer-reflect-apply', // an object's own `apply` method, which `Reflect.apply` doesn't call
  'unicorn/prefer-regexp-test', // `s.match(re)` throws for a `null` `s`, and `re.test(null)` tests `'null'`
  'unicorn/prefer-set-methods', // `Set#union` and the like are ES2025
  'unicorn/prefer-string-starts-ends-with', // `/^#/.test(null)` is `false`, `startsWith` throws
  'unicorn/prefer-toggle-attribute', // an element-like object without `toggleAttribute`, such as an `@xmldom/xmldom` element
  'unicorn/prefer-url-can-parse', // `URL.canParse` is newer than `URL`
  'unicorn/require-array-join-separator', // a `join` that isn't an array's
  'unicorn/switch-case-braces', // a declaration that a later case reads
  'unicorn/throw-new-error', // a factory named like an error class
]

/**
 * Fixes the audit judged safe. `report-only.test.ts` checks that every fixable enabled rule is here,
 * in `UNFIXED_FIXABLE_RULES` or a report-only list, so a new fixable rule is audited before it
 * fixes. No test pins a plugin rule's fix, so audit it again when a plugin's changelog changes it;
 * the own `@gpahal/*` rules' fixes are pinned by their RuleTester tests
 */
export const AUDITED_SAFE_FIXES: ReadonlyArray<string> = [
  '@gpahal/comment-layout', // only rewrites comments, and skips directive comments such as `@ts-expect-error`, `#__PURE__` and webpack's
  '@gpahal/markdown/canonical-code-block-language', // only renames a code block's language to its canonical alias, which renders the same
  '@gpahal/markdown/lowercase-code-block-language', // only lowercases a code block's language, which renders the same
  '@gpahal/markdown/no-missing-atx-heading-space', // a Markdown repair that makes `#Heading` a heading on purpose
  '@gpahal/markdown/no-shortcut-reference', // `[text][]` renders the same link as `[text]`
  '@gpahal/markdown/prefer-autolinks', // `<url>` renders the same link as `[url](url)`
  '@gpahal/no-inline-type-only-export', // drops only the load of a module whose re-exports are all types
  '@gpahal/no-js-specifier-for-ts', // rewrites a `.js` specifier that Node's type stripping can't load to the `.ts` file that exists
  '@html-eslint/require-closing-tags', // only adds the ` />` that HTML ignores on a void element
  '@html-eslint/require-doctype', // adds the doctype, a markup repair that leaves quirks mode on purpose
  '@typescript-eslint/array-type', // only rewrites the array type's syntax
  '@typescript-eslint/ban-tslint-comment', // only removes a `tslint:` comment
  '@typescript-eslint/consistent-generic-constructors', // moves the type arguments from the annotation to the constructor, which gives the same type
  '@typescript-eslint/consistent-type-assertions', // `<T>x` and `x as T` emit the same code
  '@typescript-eslint/consistent-type-definitions', // with the `type` option and `patchTypeDefinitions`, only rewrites an interface that nothing outside the file can merge with
  '@typescript-eslint/consistent-type-exports', // only marks type-only exports with `type`, which at most drops the load of a module whose re-exports are all types
  '@typescript-eslint/dot-notation', // `o['a']` and `o.a` read the same property
  '@typescript-eslint/method-signature-style', // a method's bivariant parameters and merged overloads change only what `tsc` checks, and `typescript.library` keeps it report-only for consumers
  '@typescript-eslint/no-duplicate-type-constituents', // only removes a repeated union or intersection member
  '@typescript-eslint/no-extra-non-null-assertion', // removes a `!`, which emits nothing
  '@typescript-eslint/no-import-type-side-effects', // drops only the load of a module whose imports are all types
  '@typescript-eslint/no-inferrable-types', // removes an annotation that matches the inferred type, which emits nothing
  '@typescript-eslint/no-unnecessary-boolean-literal-compare', // with types, `b === true` of a `boolean` is `b`
  '@typescript-eslint/no-unnecessary-template-expression', // with types, a template of one string is that string
  '@typescript-eslint/no-unnecessary-type-arguments', // removes a type argument equal to its default, which emits nothing
  '@typescript-eslint/no-unnecessary-type-assertion', // removes an assertion that doesn't change the type, which emits nothing
  '@typescript-eslint/no-unused-vars', // fixes only unused imports, with `imports.removeUnused`, keeping a value import's module load as `import 'x'`
  '@typescript-eslint/no-wrapper-object-types', // only rewrites a type annotation
  '@typescript-eslint/non-nullable-type-assertion-style', // `x as T` and `x!` emit the same code
  '@typescript-eslint/prefer-as-const', // `as const` gives the same literal type, which emits nothing
  '@typescript-eslint/prefer-namespace-keyword', // `module N` and `namespace N` compile the same
  '@typescript-eslint/prefer-readonly', // adds `readonly`, which emits nothing
  '@typescript-eslint/prefer-reduce-type-parameter', // moves an assertion to a type argument, which emits nothing
  '@typescript-eslint/prefer-regexp-exec', // with types, a non-global `s.match(re)` is `re.exec(s)`
  '@typescript-eslint/prefer-return-this-type', // changes only the return type to `this`, which emits nothing
  'dot-notation', // `o['a']` and `o.a` read the same property
  'import-x/newline-after-import', // only adds a blank line
  'import-x/no-duplicates', // merges imports of one module, and with `considerQueryString`, not ones that differ in a query
  'import-x/no-useless-path-segments', // writes a shorter specifier that resolves to the same file, keeping its extension
  'jsdoc/check-types', // only rewrites a type name in a comment, such as `Number` to `number`, which TypeScript reads as the same type
  'jsdoc/no-defaults', // removes a default from a `@param` tag, which changes only the docs
  'jsdoc/no-types', // removes the type from a tag in a TypeScript file, where TypeScript ignores it
  'jsdoc/require-property', // adds an empty `@property` tag, which `jsdoc/require-property-name` then reports with no fix
  'markdown-preferences/link-bracket-spacing', // only trims spaces inside link brackets, a Markdown repair; labels match ignoring outer whitespace
  'markdown-preferences/strikethrough-delimiters-style', // only turns `~x~` into `~~x~~`, which GFM renders the same
  'no-extra-boolean-cast', // `!!x` and `Boolean(x)` in a boolean context coerce the same, and only the global `Boolean` counts
  'no-regex-spaces', // ` {3}` matches the same as three spaces, and `RegExp` must be the global
  'no-undef-init', // a `let` without an initializer is `undefined`; it skips `var`, destructuring and a shadowed `undefined`
  'no-unneeded-ternary', // `x ? true : false` is `!!x`, and `x ? false : true` is `!x`, for any `x`
  'no-unused-labels', // removes an unused label, and skips a possible directive and an ASI hazard
  'no-unused-vars', // with `imports.removeUnused`, as `@typescript-eslint/no-unused-vars`, which the presets turn on in its place
  'no-useless-computed-key', // skips `__proto__`, `constructor` and `prototype`, whose computed keys differ
  'no-useless-rename', // `{ a: a }` and `{ a }` bind the same
  'no-useless-return', // removes a `return;` that code path analysis shows changes nothing
  'no-var', // fixes only where `let` scoping can't differ: no globals, redeclarations, TDZ reads or closures in loops
  'playwright/consistent-spacing-between-blocks', // only inserts blank lines between statements
  'playwright/missing-playwright-await', // adds the `await` that an asynchronous assertion needs, on purpose
  'playwright/no-useless-not', // `not.toBeVisible()` and `toBeHidden()`, and `not.toBeEnabled()` and `toBeDisabled()`, check the same state, a missing element included
  'prefer-const', // only replaces `let` with `const` for initialized bindings never reassigned
  'prefer-exponentiation-operator', // `a ** b` is `Math.pow(a, b)`, but for `bigint`s, where `Math.pow` always throws
  'regexp/match-any', // only rewrites a class that matches everything, such as `[^]`, as `[\s\S]`
  'regexp/negation', // only rewrites `[^\d]` as `\D`, which matches the same
  'regexp/no-extra-lookaround-assertions', // inlines a lookaround nested at the end of one of the same kind, which matches the same
  'regexp/no-invisible-character', // only replaces a raw invisible character with its escape
  'regexp/no-missing-g-flag', // adds the `g` flag that `replaceAll` and `matchAll` need, so code that always throws works
  'regexp/no-super-linear-backtracking', // rewrites the pattern with scslre's fix, which keeps what it matches and captures
  'regexp/no-trivially-nested-assertion', // unwraps a lookaround that holds one assertion, such as `(?=(?=a))`, which matches the same
  'regexp/no-useless-escape', // removes an identity escape, and checks that no new escape or quantifier forms
  'regexp/no-useless-quantifier', // only removes a `{1}` quantifier, and checks that no new element forms
  'regexp/no-useless-range', // only writes `a-a` as `a` and `a-b` as `ab`, escaping a `-` when needed
  'regexp/no-useless-two-nums-quantifier', // only writes `{2,2}` as `{2}`
  'regexp/prefer-d', // only writes `[0-9]` as `\d`, which no flag changes
  'regexp/prefer-plus-quantifier', // only writes `{1,}` as `+`
  'regexp/prefer-range', // only merges adjacent characters into a range, such as `abcd` into `a-d`
  'regexp/prefer-star-quantifier', // only writes `{0,}` as `*`
  'regexp/simplify-set-operations', // rewrites a `v`-flag set operation, checking that the result matches the same set
  'regexp/sort-flags', // only reorders the flags, and `.flags` reads them in a fixed order
  'storybook/await-interactions', // adds the `await` that an interaction or assertion needs, on purpose
  'toml/array-bracket-newline', // moves line breaks around an array's brackets, where TOML allows them
  'toml/array-bracket-spacing', // removes spaces inside an array's brackets
  'toml/array-element-newline', // moves line breaks between an array's elements, where TOML allows them
  'toml/comma-style', // moves a comma across the whitespace and comments beside it
  'toml/indent', // changes the indentation of lines outside multi-line strings
  'toml/inline-table-curly-spacing', // changes the spaces inside an inline table's braces, on its one line
  'toml/key-spacing', // changes the spaces around a key's `=`
  'toml/no-space-dots', // removes the spaces around a dotted key's dots, which TOML ignores
  'toml/padding-line-between-tables', // adds a blank line between tables
  'toml/quoted-keys', // unquotes a key that a bare key spells the same, as `"name"` and `name` are one key
  'toml/spaced-comment', // adds a space after a comment's `#`
  'toml/table-bracket-spacing', // removes spaces inside a table header's brackets, which TOML ignores
  'unicorn/catch-error-name', // renames a catch or promise-callback parameter and its references in its own scope
  'unicorn/consistent-assert', // `assert(x)` and `assert.ok(x)` are the same function of `node:assert`
  'unicorn/consistent-conditional-object-spread', // spreading the falsy test adds nothing, as `{}` does
  'unicorn/consistent-empty-array-spread', // spreading `[]` and `''` both add nothing
  'unicorn/consistent-existence-index-check', // `indexOf` and the `find*Index` methods return `-1` or an index, so `< 0` and `=== -1` agree
  'unicorn/consistent-export-decorator-position', // both decorator positions decorate the same class
  'unicorn/consistent-json-file-read', // `JSON.parse` turns a buffer into its UTF-8 string, which `readFile` with `utf8` returns
  'unicorn/consistent-template-literal-escape', // `$\{` and `\${` cook to the same text in an untagged template
  'unicorn/default-export-style', // `export default function f` exports the same function, which the rule skips when reassigned
  'unicorn/explicit-timer-delay', // a missing delay is `0`
  'unicorn/logical-assignment-operators', // fixes only identifiers, where skipping the self-assignment changes nothing; member access stays a suggestion
  'unicorn/no-asterisk-prefix-in-documentation-comments', // only removes the ` * ` prefixes of a doc comment
  'unicorn/no-duplicate-logical-operands', // fixes only a repeated identifier or `this`, which reads the same value twice
  'unicorn/no-leading-empty-lines', // only removes the blank lines at the start of a file
  'unicorn/no-lonely-if', // merges nested conditions into `&&`, which evaluates them the same way
  'unicorn/no-negated-array-predicate', // `!a.every(p)` and `a.some(x => !p(x))` stop at the same element and give the same result
  'unicorn/no-negated-comparison', // only flips equality operators, never relational ones
  'unicorn/no-negated-condition', // swaps the branches with the negation removed
  'unicorn/no-null', // fixes only `== null`, which matches the same values as `== undefined`
  'unicorn/no-subtraction-comparison', // fixes only operands known to be numbers, where `a - b > 0` and `a > b` agree, including for infinities and `NaN`
  'unicorn/no-typeof-undefined', // fixes only declared variables and member access, where `typeof x === 'undefined'` and `x === undefined` agree
  'unicorn/no-unnecessary-array-flat-depth', // `1` is the default depth
  'unicorn/no-unnecessary-array-flat-map', // a one-item array that `flatMap` flattens is the item that `map` returns, and `[x]`/`[]` callbacks keep what `filter` keeps
  'unicorn/no-unnecessary-array-splice-count', // an omitted `deleteCount` or `skipCount` runs to the end, as `.length` and `Infinity` do
  'unicorn/no-unnecessary-boolean-comparison', // fixes only expressions known to be booleans
  'unicorn/no-unnecessary-fetch-options', // removes options set to their defaults, or `undefined`, which WebIDL treats as missing; defaults only for a URL or string input
  'unicorn/no-unnecessary-nested-ternary', // `a ? (b ? x : y) : y` and `a && b ? x : y` evaluate the same operands
  'unicorn/no-unnecessary-slice-end', // an omitted `end` runs to the end, as `.length` and `Infinity` do
  'unicorn/no-useless-boolean-cast', // array predicate methods coerce the callback's result to a boolean themselves
  'unicorn/no-useless-collection-argument', // `new Set()` of `[]`, `''`, `null` or `undefined`, or `x ?? []`, builds the same empty or copied collection
  'unicorn/no-useless-concat', // joins two adjacent literals into the string they concatenate to
  'unicorn/no-useless-continue', // removes a `continue` that ends the loop body
  'unicorn/no-useless-delete-check', // fixes only a known `Map` or `Set`, whose `delete` of a missing key does nothing
  'unicorn/no-useless-error-capture-stack-trace', // V8 already leaves the subclass constructors out of the stack, and formats it lazily
  'unicorn/no-useless-fallback-in-spread', // spreading a nullish or falsy value adds nothing, as `{}` does
  'unicorn/no-useless-length-check', // `every` of an empty array is `true`, `some` is `false`, and `for…of` over it does nothing
  'unicorn/no-useless-logical-operand', // removes `true &&`, `false ||` and the operands after a leading `false &&` or `true ||`, keeping a trailing one unless the result is only tested
  'unicorn/no-useless-set-construction', // the Set methods already return a new set, and read only `size`, `has` and `keys` of their argument
  'unicorn/no-useless-template-literals', // inlines literals whose string value is fixed
  'unicorn/no-zero-fractions', // only rewrites the number literal's syntax
  'unicorn/numeric-separators-style', // only rewrites the number literal's syntax
  'unicorn/operator-assignment', // fixes only `a = a op b` with a simple reference, which reads and writes it once either way
  'unicorn/prefer-add-event-listener-options', // `{capture: b}` and `b` set the same capture flag
  'unicorn/prefer-array-from-map', // `Array.from` maps each item as it iterates, as the loop pushes it
  'unicorn/prefer-array-iterable-methods', // an array's `values()` and `keys()` iterate like its `entries()`
  'unicorn/prefer-bigint-literals', // fixes only integers whose literal has the same value
  'unicorn/prefer-boolean-return', // returns the test itself, `Boolean(test)` or `!test`, which the `if` reads the same way, and skips a shadowed `Boolean`
  'unicorn/prefer-combined-guards', // joins guards with the same exit text into `||`, which tests the conditions in the same order
  'unicorn/prefer-continue', // the `if` is the loop body's last statement, so `continue` skips only what falling through would skip
  'unicorn/prefer-date-now', // `new Date().getTime()`, `+new Date()` and the like read the same clock value as `Date.now()`
  'unicorn/prefer-direct-iteration', // an array's, map's or set's default iterator is the same `values` or `entries` function
  'unicorn/prefer-early-return', // the `if` is the function body's last statement, so `return;` returns what falling off the end does
  'unicorn/prefer-else-if', // fixes only when the earlier branches have no side effects and can't change the compared variable, so the skipped test is false
  'unicorn/prefer-escaped-irregular-whitespace', // only escapes irregular whitespace in a string, an untagged template or a `u` regex, which stands for the same character
  'unicorn/prefer-flat-math-min-max', // flattens nested calls of the same method, which evaluate the same arguments in the same order
  'unicorn/prefer-global-number-constants', // `Number.NaN` and `Number.POSITIVE_INFINITY` are the global values, and it skips shadowed names
  'unicorn/prefer-has-check', // fixes only where the value type excludes the missing value, or for `FormData`, `Headers` and `URLSearchParams`, whose `get` returns `null` only for a missing key
  'unicorn/prefer-hoisting-branch-code', // moves only side-effect-free leading code before side-effect-free tests, and trailing code that ran last in every branch
  'unicorn/prefer-identifier-import-export-specifiers', // a string module export name and the same identifier name the same binding
  'unicorn/prefer-iterator-to-array', // fixes only `[...Iterator.from(x)]` and `Iterator.concat` chains, where `toArray()` reads the same iterator
  'unicorn/prefer-literal-ascii', // only writes an escaped printable ASCII character of a string or untagged template as itself, which gives the same string
  'unicorn/prefer-map-from-entries', // fixes only a local `Object.fromEntries` result whose every use maps to a `Map` method, with string keys that aren't array indexes or inherited names
  'unicorn/prefer-minimal-ternary', // moves the ternary into the one differing part, and aborts unless what moves before the test is side-effect-free
  'unicorn/prefer-module', // removes `'use strict'` only in `.mjs` files, which are strict anyway; its other changes are suggestions
  'unicorn/prefer-node-protocol', // Node resolves a bare built-in name to the built-in, the same module as with `node:`, and the browser config turns it off
  'unicorn/prefer-number-properties', // `Number.parseFloat` and `Number.parseInt` are the global functions, and `isNaN`/`isFinite` become `Number.*` only for a number argument
  'unicorn/prefer-optional-catch-binding', // removes a catch binding that nothing references
  'unicorn/prefer-set-size', // `[...set].length` and `Array.from(set).length` count the set's values, which `size` gives
  'unicorn/prefer-short-escape-sequences', // only rewrites an escape of a string as a shorter one for the same character
  'unicorn/prefer-simple-condition-first', // moves a simple condition only past side-effect-free ones, and only where the result is used for its truthiness
  'unicorn/prefer-simplified-conditions', // applies De Morgan, absorption and factoring only to side-effect-free operands, keeping values outside a boolean context
  'unicorn/prefer-single-object-destructuring', // merges adjacent destructurings of the same `const`, which read the properties in the same order
  'unicorn/prefer-single-replace', // merges single-character global replacements with the same replacement, which doesn't contain a searched character, into one character class
  'unicorn/prefer-smaller-scope', // moves a declaration into the only block that uses it, where every read follows the assignment and no closure or `eval` sees it
  'unicorn/prefer-split-limit', // a limit of the read index plus one keeps the elements that the index or destructuring reads
  'unicorn/prefer-string-match-all', // rewrites an `exec` loop over a local global regex that matches no empty string and a constant string, which `matchAll` visits the same way
  'unicorn/prefer-string-raw', // `String.raw` gives the same string as the escaped literal
  'unicorn/prefer-string-repeat', // `' '.repeat(n)` gives the same string
  'unicorn/prefer-string-replace-all', // `replace` with a global regex is `replaceAll`, a literal regex matches as its string, and `split(s).join(r)` as `replaceAll` with `$` escaped
  'unicorn/prefer-string-slice', // fixes only literal indexes, or one index that it clamps with `Math.max(0, …)` and reads as the end when `undefined`, which slice the same
  'unicorn/prefer-string-trim-start-end', // `trimLeft` and `trimRight` are the same functions as `trimStart` and `trimEnd`
  'unicorn/prefer-temporal-conversion', // `Temporal.X.from(source)` of a known Temporal source gives what `source.toX()` does
  'unicorn/prefer-switch', // fixes only comparisons of a variable, which `switch` compares once each with `===`, in the same order
  'unicorn/prefer-ternary', // merges `return` or same-target assignment branches into one `return` or assignment of a ternary
  'unicorn/prefer-type-literal-last', // only reorders a union's members
  'unicorn/prefer-unary-minus', // `-x` gives the same number as `x * -1` and `x / -1`
  'unicorn/prefer-unicode-code-point-escapes', // only rewrites an escape of a string, an untagged template or a `u` regex as `\u{…}` for the same character, and skips JSX attributes
  'unicorn/prefer-url-href', // fixes only a fresh `new URL(…)`, whose `toString()` returns `href`
  'unicorn/prefer-while-loop-condition', // an infinite loop whose first statement breaks on a condition loops while the condition is false, also for `continue`
  'unicorn/relative-url-style', // removes `./` only when the resolved URL is the same for the static base or the test bases
  'unicorn/require-module-attributes', // removes an empty attribute list, which imports the same module
  'unicorn/require-module-specifiers', // removes empty specifier lists and type-only or redundant marker exports, which import the same modules
  'unicorn/require-passive-events', // adds `passive: true` only for listeners that can't call `preventDefault`, keeping `capture`
  'unicorn/require-proxy-trap-boolean-return', // replaces a trap's literal result with its boolean, which the proxy coerces it to
  'unicorn/single-line-block-comment-style', // only rewrites a block comment's layout
  'unicorn/switch-case-break-position', // moves a trailing `break` or `continue` into the block before it, which it ends the same way
  'unicorn/text-encoding-identifier-case', // autofixes only the encoding of `readFile` and `readFileSync`, where Node reads `UTF-8` and `utf8` alike
  'vitest/valid-expect', // adds the `await` that `.resolves` and `.rejects` need, on purpose
  'yoda', // only swaps a literal to the right of a comparison, which evaluates and compares the same
]

/**
 * Fixable rules that never fix with the presets' options. A fixing option you give one is unaudited
 */
export const UNFIXED_FIXABLE_RULES: ReadonlyArray<string> = [
  '@eslint-react/dom-no-missing-iframe-sandbox', // only offers suggestions, never an autofix
  '@eslint-react/dom-no-unsafe-target-blank', // only offers suggestions, never an autofix
  '@eslint-react/exhaustive-deps', // fixes only with `enableDangerousAutofixThisMayCauseInfiniteLoops`, which isn't set
  '@eslint-react/jsx-no-children-prop', // only offers suggestions, never an autofix
  '@eslint-react/jsx-no-children-prop-with-children', // only offers suggestions, never an autofix
  '@eslint-react/jsx-no-leaked-dollar', // only offers suggestions, never an autofix
  '@eslint-react/jsx-no-leaked-semicolon', // only offers suggestions, never an autofix
  '@eslint-react/no-context-provider', // only offers suggestions, never an autofix
  '@eslint-react/no-forward-ref', // only offers suggestions, never an autofix
  '@eslint-react/no-use-context', // only offers suggestions, never an autofix
  '@typescript-eslint/no-explicit-any', // fixes only with `fixToUnknown`, which the presets don't set
  'better-tailwindcss/no-conflicting-classes', // reports without a fix
  'better-tailwindcss/no-unknown-classes', // reports without a fix
  'eqeqeq', // with `smart`, fixes only `typeof` and same-type literal comparisons, which `smart` doesn't report
  'jsdoc/check-param-names', // reports without a fix, since `enableFixer` and `extraParams` default to `false`
  'jsdoc/check-property-names', // reports without a fix, since `enableFixer` defaults to `false`
  'playwright/no-standalone-expect', // reports without a fix
  'pnpm/json-prefer-workspace-settings', // reports without a fix with `autofix: false`
  'pnpm/json-valid-catalog', // reports without a fix with `autofix: false`
  'pnpm/yaml-no-duplicate-catalog-item', // declares `fixable` but reports without a fix
  'pnpm/yaml-no-unused-catalog-item', // declares `fixable` but reports without a fix
  'react-hooks/config', // only offers suggestions, never an autofix
  'react-hooks/error-boundaries', // only offers suggestions, never an autofix
  'react-hooks/exhaustive-deps', // fixes only with `enableDangerousAutofixThisMayCauseInfiniteLoops`, which isn't set
  'react-hooks/gating', // only offers suggestions, never an autofix
  'react-hooks/globals', // only offers suggestions, never an autofix
  'react-hooks/immutability', // only offers suggestions, never an autofix
  'react-hooks/incompatible-library', // only offers suggestions, never an autofix
  'react-hooks/preserve-manual-memoization', // only offers suggestions, never an autofix
  'react-hooks/purity', // only offers suggestions, never an autofix
  'react-hooks/refs', // only offers suggestions, never an autofix
  'react-hooks/set-state-in-effect', // only offers suggestions, never an autofix
  'react-hooks/set-state-in-render', // only offers suggestions, never an autofix
  'react-hooks/static-components', // only offers suggestions, never an autofix
  'react-hooks/unsupported-syntax', // only offers suggestions, never an autofix
  'react-hooks/use-memo', // only offers suggestions, never an autofix
  'react-hooks/void-use-memo', // only offers suggestions, never an autofix
  'regexp/no-misleading-unicode-character', // only suggests, since the `fixable` option defaults to `false`
  'regexp/no-unused-capturing-group', // only suggests, since the `fixable` option defaults to `false`
  'storybook/no-redundant-story-name', // only offers suggestions, never an autofix
  'storybook/prefer-pascal-case', // only offers suggestions, never an autofix
  'storybook/use-storybook-expect', // reports without a fix
  'unicorn/no-unnecessary-parameters', // fixes only without type information from the parser, which the presets always give
  'unicorn/prefer-logical-operator-over-ternary', // fixes only without type information from the parser, which the presets always give
  'vitest/no-focused-tests', // its fix is off with `fixable: false`
  'vitest/no-identical-title', // reports without a fix
  'vitest/no-interpolation-in-snapshots', // reports without a fix
]

/**
 * Code blocks show an API's shape as written, as in a VitePress `twoslash` block
 */
export const CODE_BLOCK_REPORT_ONLY_RULES: ReadonlyArray<string> = [
  '@typescript-eslint/array-type',
  '@typescript-eslint/consistent-type-definitions',
  '@typescript-eslint/method-signature-style',
  '@typescript-eslint/no-inferrable-types',
]

/**
 * `method(): void` is bivariant in its parameters and `method: () => void` isn't, so the fix can
 * break a consumer's `tsc`
 */
export const LIBRARY_REPORT_ONLY_RULES: ReadonlyArray<string> = [
  '@typescript-eslint/method-signature-style',
]

export const LIBRARY_CONFIG_NAME = 'gpahal/typescript/library'

/**
 * A fix on save would make a `let` about to be reassigned a `const`
 */
export const EDITOR_REPORT_ONLY_RULES: ReadonlyArray<string> = ['prefer-const']
