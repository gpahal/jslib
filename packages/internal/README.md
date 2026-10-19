# @gpahal/internal

Unpublished code shared by the `@gpahal/*` packages. A package imports it as a dev dependency, and tsdown bundles its code and types into the package's build. Its own dependencies, such as `@gpahal/std`, `zod` and `brace-expansion`, stay external, so a package depends on what the modules it imports import. std can't use it, since it depends on std.

## Modules

Each module is a subpath. The modules in `src/` are browser-safe: `tsconfig.browser.json` type-checks them without Node's types, and `tests/browser.test.ts` checks that their builds import no Node module. Node-only modules are in `src/node/`, imported as `@gpahal/internal/node/<name>`.

| Module | Main exports | Runs in |
| --- | --- | --- |
| `comments` | `getBlockCommentLines`, `hasMixedStarPrefixes`, `hasTextStar`, `hasUnusualLineTerminator`, `isStarredCommentLine` | Anywhere |
| `globs` | `expandBraces`, `scanBraces` | Anywhere |
| `node/options` | `optionsObject`, `required`, `deferred`, `booleanOr`, `listOption`, `resolveListOption`, `resolveSubOptions`, `isStringOrStrings` | Node |
| `node/zod` | `assertValid`, `strictObject`, `plainObject`, `typeCheck`, `stringOrStrings`, `expectedError`, `loadZod` | Node |
| `node/cli` | `readPackageVersion`, `formatCliError`, `getCauses` | Node |
| `node/json` | `readJsonFile` | Node |
| `node/package-manager` | `detectPackageManager`, `formatInstallCommand` | Node |
| `node/paths` | `resolvePathOrFileUrl`, `isRelativePath`, the `PATH_OR_FILE_URL_*` messages | Node |
| `node/resolve` | `resolvePath`, `isResolvable`, `resolveFromNodeModules`, `resolveFile`, `findInstalledPackage`, `missingPeersError`, `formatPeerSpecifier` | Node |
| `node/root` | `checkRoot` | Node |
| `node/source-maps` | `isSourceMap`, `resolveSourcePath`, `isHashedSource`, `hashSource`, `isPublishedFile`, `dropSources` | Node, builds and tests only |
| `node/testing` | `runNode`, `runNodeOk`, `withTmpProject`, `writeFiles`, `assertBuildIsCurrent`, `countCalls`, `countWork`, `minCpuMs`, `readMarkdownSection`, `readCodeBlocks`, `splitFileNameComment` | Node, tests only |

The JSDoc gives the details. The rules that span modules:

- `node/resolve`'s functions take the caller's `import.meta.resolve`, as `(specifier) => import.meta.resolve(specifier)`, so a package resolves from itself. `resolveFromNodeModules` and `findInstalledPackage` resolve from a user's file through the `node_modules` folders above it, never `NODE_PATH`, which pnpm sets for package scripts.
- `assertBuildIsCurrent(buildDir)` checks a build against the SHA-256 source hashes that the root `tsdown.config.ts` records in each source map, which survive Turbo cache restores.
- Only tests import `node/testing`. The root ESLint config forbids importing it in `packages/*/src`.

## node/options and node/zod

`node/zod` holds Zod Mini schemas and `assertValid`:

- `assertValid` throws a `TypeError` in the repo's error shape, naming each issue by its path, or by `rootSubject` for the value itself, listing at most 20. Most issues read as `expected …, received …`. Rarer ones keep Zod's English message, lowercased.
- For a failed union, it reports the branches that took the value's type, or the union's own error when none did. A failed `typeCheck` counts as rejecting the type, so check a type such as a function with `typeCheck` rather than `z.custom`.
- It returns what the schema outputs, which callers read rather than the value they passed. `strictObject` and `plainObject` output a copy of their own keys without a prototype, so a left-out key never reads an inherited value. A coercing schema, or one with a default, fails to compile.

Neither module imports Zod. Their functions call `loadZod()`, which loads Zod Mini on its first call and returns the instance that `import` gives. A package that builds its schemas inside a function with `z` from `loadZod()`, as prettier-config does, loads no Zod until it checks options.

`node/options` builds the schemas of config functions' options on it:

- `optionsObject<T>(shape)` takes a schema for each key of the options type `T`, wrapped in `required(...)` exactly where `T` requires the key, so a mismatched schema fails to compile, and `assertValid` returns the options as a `T`. The output leaves out an optional key given as `undefined`.
- `deferred<T>()` is the schema for a key that a later check validates, such as one passed on to a tool. It takes any value as a `T`, and `deferred<T>(schema)` checks only what `schema` checks. A required key may take it without `required(...)`, when the later check also reports the key left out.
- `booleanOr` and `listOption` build the schemas of common option forms, and `resolveListOption` and `resolveSubOptions` resolve them. A list option takes an array, which replaces its defaults, or a function that gets a copy of them and returns the list to use.

```ts
import * as z from 'zod/mini'

import {
  booleanOr,
  listOption,
  optionsObject,
  required,
  type ListOption,
} from '@gpahal/internal/node/options'
import { assertValid, expectedError } from '@gpahal/internal/node/zod'

type Options = {
  root: string
  ignores?: ListOption | undefined
  react?: boolean | { refresh?: boolean | undefined } | undefined
}

const OPTIONS_SCHEMA = optionsObject<Options>({
  root: required(z.string({ error: expectedError('an absolute path') })),
  ignores: listOption(z.string(), 'globs'),
  react: booleanOr(optionsObject<{ refresh?: boolean | undefined }>({ refresh: z.boolean() })),
})

export function defineConfig(options: Options) {
  // For JavaScript callers, which the types don't stop
  const untypedOptions: unknown = options
  const { root, ignores, react } = assertValid(OPTIONS_SCHEMA, untypedOptions, {
    prefix: '@gpahal/x',
    rootSubject: 'options',
  })
}
```
