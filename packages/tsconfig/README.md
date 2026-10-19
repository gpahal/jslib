# @gpahal/tsconfig

Shared TypeScript config presets for base, Node, browser, React, Next.js and Astro projects, and for libraries.

- [Install](#install)
- [Choose presets](#choose-presets)
- [Quick start](#quick-start)
- [Recipes](#recipes)
  - [The strictest checks](#the-strictest-checks)
  - [A browser app without a framework](#a-browser-app-without-a-framework)
  - [A Next.js app](#a-nextjs-app)
  - [An Astro app with islands](#an-astro-app-with-islands)
  - [Root config files of a React or Astro app][]
  - [A Node app that strips types](#a-node-app-that-strips-types)
  - [A project with global types](#a-project-with-global-types)
  - [Code that Node runs as `tsc` emits it](#code-that-node-runs-as-tsc-emits-it)
  - [A library built by a bundler][]
  - [A library built by `tsc`](#a-library-built-by-tsc)
  - [A monorepo of composite projects](#a-monorepo-of-composite-projects)
- [Reference](#reference)
  - [Modules](#modules)
  - [Libs and types][]
  - [Runtimes](#runtimes)

## Install

```sh
pnpm add -D @gpahal/tsconfig typescript@~6.0.3
```

Needs TypeScript `~6.0.3`. TypeScript 7 is not supported right now. `node`, `node-app` and `nextjs-app` also require `@types/node`.

## Choose presets

An app extends one `*-app` preset, and a library combines `base` with mixins.

| Code | Preset or recipe |
| --- | --- |
| A browser app that a bundler builds, such as vanilla Vite | `browser-app`: [A browser app without a framework][] |
| A React, Next.js or Astro app | `react-app`, [`nextjs-app`](#a-nextjs-app) or [`astro-app`](#an-astro-app-with-islands) |
| A Node app whose `.ts` files Node runs with type stripping | `node-app`: [A Node app that strips types][] |
| A Node app that runs the JavaScript `tsc` emits | [Code that Node runs as `tsc` emits it](#code-that-node-runs-as-tsc-emits-it) |
| A library that a bundler builds, for Node or the browser | [A library built by a bundler][] |
| A library that `tsc` builds | [A library built by `tsc`](#a-library-built-by-tsc) |
| Browser code outside an app, such as a library's browser entry | `base` and `browser` |
| Code for neither host, such as a worker or an edge runtime | `base`: [Runtimes](#runtimes) |

## Quick start

```json
{
  "extends": "@gpahal/tsconfig/react-app",
  "compilerOptions": { "types": ["vite/client"] }
}
```

Extend a preset by name, with or without `.json`. `"extends": "@gpahal/tsconfig"` extends `base`. `base` leaves `types` empty, so a Vite app lists `vite/client`, as Vite's templates do; without it, CSS and asset imports fail with TS2882 and TS2307. An `*-app` preset includes every file in the tsconfig's folder minus build output and turns on `incremental`, so add `*.tsbuildinfo` to `.gitignore`. `browser-app`, `react-app` and `astro-app` leave out the root config files, which [need their own tsconfig][Root config files of a React or Astro app].

The `*-app` presets leave `allowJs` off, so importing a local `.js` module fails with TS7016. Next.js's and Astro's stock tsconfigs turn it on, so when you migrate from them, you may need `"allowJs": true`.

## Recipes

### The strictest checks

```json
{
  "extends": ["@gpahal/tsconfig/react-app", "@gpahal/tsconfig/strictest"]
}
```

`base` has every check of [@tsconfig/strictest](https://github.com/tsconfig/bases/blob/main/bases/strictest.json) except `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, `noUnusedLocals` and `noUnusedParameters`. `strictest` adds the first two, and leaves unused variables to ESLint.

`noPropertyAccessFromIndexSignature` rejects dotted access to a key that only an index signature declares, with TS4111. create-next-app's starter fails `next build` with it. Use bracket access or declare the keys:

- CSS Modules: write `styles['page']`.
- `import.meta.env`: declare your `VITE_*` keys in a `.d.ts` file.
- `process.env`: write `process.env['API_URL']`. Next.js still inlines a bracketed `process.env['NEXT_PUBLIC_API_URL']`.
- Astro: write `Astro.params['slug']`.

```ts
// src/env.d.ts
interface ImportMetaEnv {
  readonly VITE_API_URL: string
}
```

### A browser app without a framework

```json
{
  "extends": "@gpahal/tsconfig/browser-app",
  "compilerOptions": { "types": ["vite/client"] }
}
```

`browser-app` is `base` plus `browser`, which types the DOM with the ES2024 lib and target, without JSX. Like `react-app`, it needs `vite/client` for a Vite app and leaves out the root `*.config.*` files.

### A Next.js app

```json
{
  "extends": "@gpahal/tsconfig/nextjs-app",
  "compilerOptions": { "paths": { "@/*": ["./*"] } }
}
```

When you replace create-next-app's tsconfig, keep its `paths`. The preset sets none, and Next.js doesn't add them back. `nextjs-app` requires Next.js 16 or later, which needs the `react-jsx` setting the preset inherits from `react` and doesn't edit a tsconfig that has `extends` or `references`. The preset sets `"types": ["node"]`, so root config files such as `next.config.ts` get Node's types in tools that read only the compiler options, such as `@gpahal/eslint-config`'s default project. If you set your own `types`, keep `node`.

The preset's `include` hard-codes `.next/types` and `.next/dev/types`. With a custom `distDir`, add `<distDir>/types/**/*.ts` and `<distDir>/dev/types/**/*.ts` to the preset's `include`. If `distDir` is `dist`, `build` or `out`, also set `exclude` to the preset's list without that folder. For `distDir: 'build'`:

```json
{
  "extends": "@gpahal/tsconfig/nextjs-app",
  "include": [
    "next-env.d.ts",
    "**/*",
    ".next/types/**/*.ts",
    ".next/dev/types/**/*.ts",
    "build/types/**/*.ts",
    "build/dev/types/**/*.ts"
  ],
  "exclude": ["dist", "out", "coverage"]
}
```

### An Astro app with islands

```json
{
  "extends": "@gpahal/tsconfig/astro-app",
  "compilerOptions": { "jsxImportSource": "react" }
}
```

`jsxImportSource` makes `.tsx` files check against the UI framework's JSX, and `astro check` checks the `.astro` files that `tsc` skips.

### Root config files of a React or Astro app

This is the full setup of a Vite React app. `react-app` and `astro-app` type the browser without Node's types, so they exclude the `*.config.*` files in the tsconfig's folder, such as `vite.config.ts`. Files in subfolders stay in the app. Check the root config files with a `tsconfig.node.json`, and make `tsconfig.json` a solution that references both projects, as Vite's templates do. Editors and `@gpahal/eslint-config` find a file's project through those references.

```json
// tsconfig.json
{
  "files": [],
  "references": [{ "path": "./tsconfig.app.json" }, { "path": "./tsconfig.node.json" }]
}
```

```json
// tsconfig.app.json
{
  "extends": "@gpahal/tsconfig/react-app",
  "compilerOptions": { "types": ["vite/client"] }
}
```

```json
// tsconfig.node.json
{
  "extends": ["@gpahal/tsconfig/base", "@gpahal/tsconfig/node"],
  "compilerOptions": {
    "allowJs": true,
    "checkJs": true,
    "allowImportingTsExtensions": true,
    "incremental": true
  },
  "include": ["*.config.*"]
}
```

`allowJs` and `checkJs` check JavaScript config files, such as `astro.config.mjs`; without a matching file, `tsc` fails with "No inputs were found". `allowImportingTsExtensions` accepts `.ts` imports in a config file. An Astro app replaces `react-app` with `astro-app` and drops `vite/client`, since `.astro/types.d.ts` types its imports. `tsc -b` checks every referenced project:

```json
{
  "scripts": { "typecheck": "tsc -b" }
}
```

Astro reads `paths` only from `tsconfig.json`, which holds no compiler options here, so use `package.json` `imports` for aliases. `@gpahal/eslint-config`'s `astro` option reads the `tsconfig.json` of an `.astro` file's folder without following its references, so with that option keep the Astro app in `tsconfig.json`, as the [Astro setup recipe](https://github.com/gpahal/jslib#astro-with-react-tailwind-css-and-vitest) does.

### A Node app that strips types

```json
{
  "extends": "@gpahal/tsconfig/node-app"
}
```

Set `"type": "module"` in `package.json`; otherwise `nodenext` treats `.ts` files as CommonJS, and `verbatimModuleSyntax` rejects every `import` and `export`. `node-app` turns on `erasableSyntaxOnly`, which rejects `enum`, namespaces with values, parameter properties, `<T>x` assertions, `import x = require()` and `export =`. It doesn't reject decorators or `accessor` fields, which pass `tsc` and fail in Node. Import with `.ts` extensions: TypeScript also accepts `import './b.js'` for a `b.ts` file, which Node can't find. Turn on `node: { typeStripping: true }` in [`@gpahal/eslint-config`](https://github.com/gpahal/jslib/tree/main/packages/eslint-config#own-rules) to report all three. Node doesn't strip types inside `node_modules`, so dependencies must ship JavaScript.

Node doesn't type-check or read `paths`, so run `tsc` and use `package.json` `imports` for aliases. Map the alias to the `.ts` files and import it without an extension:

```json
{
  "imports": { "#lib/*": "./src/lib/*.ts" }
}
```

Then `import { b } from '#lib/b'` loads `src/lib/b.ts`. `rewriteRelativeImportExtensions` rejects a `.ts` extension in a non-relative import with TS2877, so `'#lib/b.ts'` with `"#lib/*": "./src/lib/*"` fails `tsc`.

### A project with global types

```json
{
  "extends": "@gpahal/tsconfig/base",
  "compilerOptions": { "types": ["node", "vitest/globals"] },
  "include": ["src", "tests"]
}
```

`base` only type-checks, and `types` is empty until you list the packages whose globals you use.

### Code that Node runs as `tsc` emits it

```json
{
  "extends": ["@gpahal/tsconfig/base", "@gpahal/tsconfig/nodenext", "@gpahal/tsconfig/node"],
  "compilerOptions": { "noEmit": false, "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

`nodenext` requires `import './b.js'`, which Node can resolve. List `base` first, since a later preset wins, and set `"type": "module"` in `package.json`. For test configs, see [Libs and types][].

### A library built by a bundler

`base` types ES2025 without Node's or the browser's APIs, so a library adds its host's. For a library that runs in Node, add Node's types:

```json
{
  "extends": [
    "@gpahal/tsconfig/base",
    "@gpahal/tsconfig/library",
    "@gpahal/tsconfig/erasable",
    "@gpahal/tsconfig/strictest"
  ],
  "compilerOptions": { "types": ["node"] },
  "include": ["src"]
}
```

For a library that runs in the browser, add the DOM library:

```json
{
  "extends": [
    "@gpahal/tsconfig/base",
    "@gpahal/tsconfig/library",
    "@gpahal/tsconfig/erasable",
    "@gpahal/tsconfig/strictest"
  ],
  "compilerOptions": { "lib": ["es2025", "dom"] },
  "include": ["src"]
}
```

`base` rejects `.ts` extensions in imports with TS5097. A bundler such as tsdown rewrites them, so to write `import { b } from './b.ts'`, add `"allowImportingTsExtensions": true`.

`library` turns on `isolatedDeclarations`, so exports need explicit types. `@gpahal/eslint-config`'s `typescript.library` option reports only those of exported functions and methods. The tests turn it off with `library-tests` in `tests/tsconfig.json`:

```json
{
  "extends": ["../tsconfig.json", "@gpahal/tsconfig/library-tests"],
  "include": ["**/*"]
}
```

The tests' config sets its own `include`, since the inherited one resolves against the library's folder. When the library's tsconfig sets `declarationDir`, also add `"compilerOptions": { "declarationDir": null }`. `library-tests` can't clear it itself: tsconfck, which Vite, Vitest and vite-tsconfig-paths use, fails on a `null` in an extended config.

### A library built by `tsc`

```json
{
  "extends": [
    "@gpahal/tsconfig/base",
    "@gpahal/tsconfig/nodenext",
    "@gpahal/tsconfig/node",
    "@gpahal/tsconfig/library"
  ],
  "compilerOptions": { "noEmit": false, "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

TypeScript 6 needs `rootDir` with `outDir` when the sources are in a folder. The tests' tsconfig widens `rootDir` to cover `src` and `tests`:

```json
{
  "extends": ["../tsconfig.json", "@gpahal/tsconfig/library-tests"],
  "compilerOptions": { "rootDir": ".." },
  "include": ["**/*"]
}
```

`library` turns on `declarationMap` and `sourceMap`, whose maps point at the files in `src`. If you publish only `dist`, publish `src` too or turn both off.

### A monorepo of composite projects

`base` sets `noEmit`, which a referenced project can't have, so `tsc -b` over packages that reference each other fails with TS6310. Make each package a composite project that emits only declarations, here `b`, which depends on `a`:

```jsonc
// packages/b/tsconfig.json
{
  "extends": ["@gpahal/tsconfig/base", "@gpahal/tsconfig/library"],
  "compilerOptions": {
    "composite": true,
    "noEmit": false,
    "emitDeclarationOnly": true,
    "rootDir": "src",
    "outDir": "dist",
  },
  "include": ["src"],
  "references": [{ "path": "../a" }],
}
```

`a`'s tsconfig is the same without `references`. A root `tsconfig.json` references every package:

```jsonc
// tsconfig.json
{
  "files": [],
  "references": [{ "path": "./packages/a" }, { "path": "./packages/b" }],
}
```

`tsc -b` then checks the packages in dependency order and skips unchanged ones. `a`'s `package.json` points its `types` into the `outDir`, so TypeScript takes them for the referenced project's output. A bundler still builds the JavaScript.

## Reference

The `*-app` presets are complete: each extends `base` and sets the files to check. The others are mixins that set only their own options, so list them after `base` or an `*-app` preset. A mixin used alone doesn't set `noEmit`.

| Preset | Extends | Adds |
| --- | --- | --- |
| `base` |  | `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `allowUnreachableCode: false`, `allowUnusedLabels: false`, empty `types`, `preserve` module and `bundler` module resolution, `moduleDetection: force`, `useDefineForClassFields`, ES2025 target, ES2025 lib without DOM, `verbatimModuleSyntax`, `noEmit`, `noEmitOnError`, `preserveWatchOutput`, `skipLibCheck` |
| `nodenext` |  | `nodenext` module and module resolution |
| `node` |  | ES2025 target, `node` types, the ES2025 lib plus the ESNext APIs that Node 24 has |
| `node-app` | `base`, `nodenext`, `node`, `node-strip-types` | `incremental`, `include` and `exclude`. Requires `"type": "module"` |
| `browser-app` | `base`, `browser` | `allowImportingTsExtensions`, `incremental`, `include` and `exclude`, which leaves out root `*.config.*` files |
| `react-app` | `base`, `react` | `allowImportingTsExtensions`, `incremental`, `include` and `exclude`, which leaves out root `*.config.*` files |
| `nextjs-app` | `base`, `nextjs` | `allowImportingTsExtensions`, `incremental`, `node` types, `include` and `exclude` |
| `astro-app` | `base`, `astro` | `allowImportingTsExtensions`, `incremental`, `include` and `exclude`, which leaves out root `*.config.*` files |
| `browser` |  | `preserve` module and `bundler` module resolution, ES2024 target, ES2024 and DOM lib, no JSX |
| `react` |  | ES2024 target, ES2024 and DOM lib, `jsx: react-jsx` |
| `nextjs` | `react` | The Next.js plugin. Requires Next.js 16 or later |
| `astro` |  | ES2024 target, ES2024 and DOM lib, `jsx: preserve` |
| `library` |  | `declaration`, `declarationMap`, `isolatedDeclarations` and `sourceMap` |
| `library-tests` |  | `noEmit`; disables `declaration`, `declarationMap`, `emitDeclarationOnly`, `isolatedDeclarations` and `composite`. List it after the library's tsconfig |
| `erasable` |  | `erasableSyntaxOnly` |
| `node-strip-types` | `erasable` | `rewriteRelativeImportExtensions` |
| `strictest` |  | `noPropertyAccessFromIndexSignature` and `exactOptionalPropertyTypes` |

The `*-app` presets set `include` and `exclude` through `${configDir}`, and setting either yourself replaces the preset's list. `files` adds to the preset's `include`; set `"include": []` to check only `files`. They exclude `dist`, `build`, `out` and `coverage`. TypeScript adds `outDir` to the exclude only when the tsconfig sets no `exclude`, so to emit from an `*-app` preset, use one of those folders as `outDir` or add it to `exclude`, and set `rootDir` when the sources are in a subfolder. The browser `*-app` presets allow `.ts` imports, so emitting from them also needs `"rewriteRelativeImportExtensions": true` or `emitDeclarationOnly`.

### Modules

`base` sets `"module": "preserve"` and `"moduleResolution": "bundler"`, which TypeScript recommends for code that a bundler builds: it checks imports as a bundler resolves them and emits them as written. It also accepts `import fs = require('node:fs')`, the typed way to import in a `.cts` file, where `verbatimModuleSyntax` rejects `import` and `export`; export with `export =`. `erasable` rejects both, so leave `.cts` files out of `node-app` and the bundler library projects, or drop `erasable`. The `nodenext` presets replace both settings for code that Node runs.

### Libs and types

- TypeScript replaces `lib`, `types`, `plugins`, `include` and `exclude` from an extended config rather than merging them. Include `node` when you set your own `types`, and `{ "name": "next" }` when you set `plugins` with `nextjs-app`.
- `node`, `browser`, `react` and `astro` each set `lib`, and the last one wins. For code that runs in Node and the browser, put `node` before `react` to keep the DOM; you lose `node`'s ESNext APIs.
- `base` targets and types ES2025, without Node's or the browser's APIs. `node` adds the ESNext APIs that Node 24 has, such as `Array.fromAsync`, `Error.isError` and `Atomics.pause`, so code built on `node` or `node-app` needs Node 24 or later.
- The browser presets use the `es2024` target and lib, which are Baseline widely available except resizable `ArrayBuffer`, growable `SharedArrayBuffer` and `Atomics.waitAsync`. Set `"lib": ["es2025", "dom"]` for `Promise.try` and the `Set` methods.
- `skipLibCheck` skips your own `.d.ts` files too. Write `declare global` blocks in `.ts` files; in a `.d.ts` file without imports or exports it's an error that `skipLibCheck` hides.
- `moduleDetection: force` makes every `.ts` file a module, where a wildcard module declaration such as `declare module '*.svg'` fails with TS2664. Write those in `.d.ts` files.

### Runtimes

`target` sets the syntax `tsc` emits, and `lib` the APIs it accepts. Neither adds polyfills, so set them to what the oldest runtime you support has. For browsers older than ES2024, such as Safari 15, lower both:

```json
{
  "extends": "@gpahal/tsconfig/react-app",
  "compilerOptions": { "target": "es2021", "lib": ["es2021", "dom"] }
}
```

`base` sets `useDefineForClassFields`, which defaults to off below `es2022`, so lowering `target` keeps the class-field semantics that Vite, esbuild and tsx compile with.

A web worker or service worker has no DOM. Give its code its own tsconfig with the `webworker` lib:

```json
{
  "extends": "@gpahal/tsconfig/base",
  "compilerOptions": { "lib": ["es2024", "webworker"], "types": [] },
  "include": ["src"]
}
```

An edge runtime, such as Cloudflare Workers, has neither the DOM nor Node: keep `lib` at ES versions and list the runtime's types, such as `"types": ["@cloudflare/workers-types"]`.

[A Node app that strips types]: #a-node-app-that-strips-types
[A browser app without a framework]: #a-browser-app-without-a-framework
[A library built by a bundler]: #a-library-built-by-a-bundler
[Libs and types]: #libs-and-types
[Root config files of a React or Astro app]: #root-config-files-of-a-react-or-astro-app
