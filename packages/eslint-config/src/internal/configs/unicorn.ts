import eslintPluginUnicorn from 'eslint-plugin-unicorn'

import { FILENAME_CASE_IGNORES } from '@/internal/configs/constants'
import { JSX_FILES } from '@/internal/files'
import { intersectFiles } from '@/internal/globs'
import type { FileSpecs } from '@/internal/globs'
import { named } from '@/internal/naming'
import type { TypedConfig } from '@/internal/types'

export type UnicornOptions = {
  files: Array<string>
}

export function unicorn({ files }: UnicornOptions): Array<TypedConfig> {
  return [
    ...named('unicorn', { files }, [eslintPluginUnicorn.configs.recommended]),
    {
      name: 'gpahal/unicorn/rules',
      files,
      rules: {
        'unicorn/no-null': 'off',
        'unicorn/no-array-callback-reference': 'off',
        'unicorn/no-negated-condition': 'off',
        'unicorn/no-nested-ternary': 'off',
        'unicorn/no-useless-undefined': 'off',
        'unicorn/number-literal-case': 'off',
        'unicorn/name-replacements': 'off',
        'unicorn/no-await-expression-member': 'off',
        'unicorn/no-for-each': 'off',
        // `array.sort()` sorts in place, which may change a parameter or a prop
        'unicorn/no-array-sort': ['error', { allowExpressionStatement: false }],
        'unicorn/no-unsafe-dom-html': 'error',
        // `patchFilenameCase` adds these ignores to the options you give it too
        'unicorn/filename-case': [
          'error',
          { case: 'kebabCase', ignore: [...FILENAME_CASE_IGNORES] },
        ],
        // `@gpahal/comment-layout` owns comment layout, and this expands `/** @type {T} */`
        'unicorn/single-line-block-comment-style': 'off',
        // It strips the ` * ` prefix that comment-layout keeps, so `--fix` never settles
        'unicorn/no-asterisk-prefix-in-documentation-comments': 'off',
        // `Array.from(s, fn)` for `Array.from(s).map(fn)`, where `unicorn/prefer-spread` asks for
        // `[...s].map(fn)`
        'unicorn/prefer-array-from-map': 'off',
        // Naming opinions, which reviews judge better. The first was also the slowest rule
        'unicorn/consistent-boolean-name': 'off',
        'unicorn/consistent-compound-words': 'off',
        'unicorn/no-non-function-verb-prefix': 'off',
        // A parameter each call passes the same value may vary later, as a test helper's does
        'unicorn/no-unnecessary-parameters': 'off',
        // `reduce` is clear for folds, and `e18e/no-spread-in-reduce` reports the costly ones
        'unicorn/no-array-reduce': 'off',
        // A module may set up state, such as a cache or a registry, when it loads
        'unicorn/no-top-level-side-effects': 'off',
        // Members are grouped by what they do, not by kind
        'unicorn/consistent-class-member-order': 'off',
        // Call chains read top to bottom, however deep
        'unicorn/max-nested-calls': 'off',
        // A synchronous callback starts async work with `run().catch(report)`, and
        // typescript-eslint reports floating and unawaited promises
        'unicorn/prefer-await': 'off',
        // `break` in a `switch` inside a loop, and `no-labels` reports the labelled `break` it asks for
        'unicorn/no-break-in-nested-loop': 'off',
        // `this` in an object literal's methods and in functions with a JSDoc `@this`
        'unicorn/no-this-outside-of-class': 'off',
        // `Number.parseInt(x, 10)` and `Number.parseFloat(x)` read `'12px'` as 12, which its
        // `Math.trunc(Number(x))` doesn't
        'unicorn/prefer-number-coercion': 'off',
        // `key in object` with a dynamic key, TypeScript's type guard
        'unicorn/no-computed-property-existence-check': 'off',
        // Not a guard clause, such as `if (error instanceof Error) { return error.message }`
        // before `return String(error)`
        'unicorn/prefer-ternary': ['error', 'only-single-line'],
        // `value || fallback` also replaces `''` and `0`, and `value ?? fallback` also `null`, which
        // a default parameter doesn't
        'unicorn/prefer-default-parameters': ['error', { checkFallbackExpressions: false }],
        // `Iterator.zip` isn't in Node 24, so code that follows the advice breaks at run time
        'unicorn/prefer-iterator-zip': 'off',
        // Its reports depend on the date and installed versions, so a clean commit can fail later
        'unicorn/expiring-todo-comments': 'off',
        // A `ResizeObserver` doesn't give the viewport's width with its scrollbar, as `innerWidth`
        // does, and it doesn't suggest `matchMedia`, the usual replacement
        'unicorn/prefer-observer-apis': 'off',
        // Any style of `node:path` and `node:util` imports passes, such as `import { join } from
        // 'node:path'`
        'unicorn/import-style': ['error', { styles: { path: false, util: false } }],
      },
    },
    // A JSX callback often uses nothing from the component, and
    // `@eslint-react/no-nested-component-definitions` reports nested components
    {
      name: 'gpahal/unicorn/rules-jsx',
      files: intersectFiles(files, JSX_FILES),
      rules: {
        'unicorn/consistent-function-scoping': 'off',
      },
    },
  ]
}

/**
 * `EventEmitter` is Node's, and `EventTarget` lacks its API
 */
export function unicornNodeExemptions({ files }: { files: FileSpecs }): Array<TypedConfig> {
  if (files.length === 0) {
    return []
  }
  return [
    {
      name: 'gpahal/unicorn/rules-node',
      files,
      rules: {
        'unicorn/prefer-event-target': 'off',
      },
    },
  ]
}

/**
 * A helper beside its test reads clearer, and a test may stub a global, as `globalThis.fetch`
 */
export function unicornTestExemptions({ testFiles }: { testFiles: FileSpecs }): Array<TypedConfig> {
  return [
    {
      name: 'gpahal/unicorn/rules-test',
      files: testFiles,
      rules: {
        'unicorn/consistent-function-scoping': 'off',
        'unicorn/no-global-object-property-assignment': 'off',
      },
    },
  ]
}

/**
 * The presets' ES2024 browser `lib` lacks ES2025's iterator helpers and the newer `Array.fromAsync()`, and
 * bundlers targeting browsers without top-level `await`, such as Vite 5 and 6 with `es2020`, fail
 * to build it
 */
export function unicornBrowserExemptions({
  files,
  ignores,
}: {
  files: FileSpecs
  ignores: Array<string>
}): Array<TypedConfig> {
  if (files.length === 0) {
    return []
  }
  return [
    {
      name: 'gpahal/unicorn/rules-browser',
      files,
      ...(ignores.length > 0 && { ignores }),
      rules: {
        'unicorn/prefer-iterator-helpers': 'off',
        'unicorn/prefer-iterator-to-array': 'off',
        'unicorn/prefer-iterator-to-array-at-end': 'off',
        'unicorn/prefer-array-from-async': 'off',
        'unicorn/prefer-top-level-await': 'off',
      },
    },
  ]
}
