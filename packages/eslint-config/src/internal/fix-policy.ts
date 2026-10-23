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
