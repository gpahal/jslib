# jslib

TypeScript libraries and config presets that I use in my projects, published to npm as `@gpahal/*`.

- [Packages](#packages)
- [Supported setups](#supported-setups)
  - [TypeScript version](#typescript-version)
  - [Options the config packages share](#options-the-config-packages-share)
- [Setup recipes](#setup-recipes)
  - [A minimal project](#a-minimal-project)
  - [A pnpm monorepo](#a-pnpm-monorepo)
  - [Vite with React](#vite-with-react)
  - [Next.js with Tailwind CSS](#nextjs-with-tailwind-css)
  - [Astro with React, Tailwind CSS and Vitest](#astro-with-react-tailwind-css-and-vitest)
  - [Running the fixers][]
- [Editor setup](#editor-setup)
- [Adopt in an existing codebase](#adopt-in-an-existing-codebase)
- [Troubleshooting](#troubleshooting)
  - [`needs typescript ~6.0.3`, or `ERESOLVE`](#needs-typescript-603-or-eresolve)
  - [`ERR_PNPM_IGNORED_BUILDS`](#err_pnpm_ignored_builds)
  - [`ERR_REQUIRE_ASYNC_MODULE` from Stylelint](#err_require_async_module-from-stylelint)
  - [The editor shows stale ESLint results](#the-editor-shows-stale-eslint-results)
  - [A `GPAHAL_…` warning](#a-gpahal_-warning)
- [Install hardening](#install-hardening)
- [Lists and merging][]
- [Development](#development)
- [Releasing](#releasing)
- [License](#license)

## Packages

Config presets:

- [@gpahal/tsconfig](packages/tsconfig): TypeScript config presets for base, Node, browser, React, Next.js and Astro projects, and for libraries.
- [@gpahal/eslint-config](packages/eslint-config): composable flat ESLint config.
- [@gpahal/prettier-config](packages/prettier-config): Prettier config with sorted imports and `package.json` keys.
- [@gpahal/stylelint-config](packages/stylelint-config): Stylelint config, with a variant for Tailwind CSS v4.

Libraries:

- [@gpahal/std](packages/std): standard library of TypeScript utilities.
- [@gpahal/font-fallback](packages/font-fallback): size-adjusted local fallbacks for web fonts.

Internal, never published:

- [@gpahal/internal](packages/internal): code the packages share and bundle, such as their option schemas.
- [@gpahal/recipes](packages/recipes): end-to-end checks of the [setup recipes](#setup-recipes) and of the packages' test scripts.

## Supported setups

The packages need Node 24.22 or later on macOS or Linux. They resolve plugins and peers from npm's and pnpm's `node_modules` layouts. Windows and Yarn Plug'n'Play aren't supported.

| Package | Node | Required peers | Optional peers |
| --- | --- | --- | --- |
| `@gpahal/eslint-config` | `>=24.22.0` | `eslint` `^10.11` | `typescript` and the plugins of each preset, listed in [Install](packages/eslint-config/README.md#install) |
| `@gpahal/prettier-config` | `>=24.22.0` | `prettier` `^3.9` | `prettier-plugin-astro` `^1.1`, `prettier-plugin-tailwindcss` `>=0.8.0 <0.9.0` |
| `@gpahal/stylelint-config` | `>=24.22.0` | `stylelint` `^17.15` | `tailwindcss` `^4.3` |
| `@gpahal/tsconfig` | Any | `typescript` `~6.0.3` | `@types/node` `*` |
| `@gpahal/std` | `>=24.22.0` in Node; any modern browser | None | None |
| `@gpahal/font-fallback` | `>=24.22.0` | None | None |

eslint-config's import resolver depends on `unrs-resolver`, whose build script linting doesn't need. With pnpm, the recipes skip it, as [`ERR_PNPM_IGNORED_BUILDS`](#err_pnpm_ignored_builds) explains. npm 12 skips install scripts by default and lists the skipped ones; to drop `unrs-resolver` from that list, run `npm deny-scripts unrs-resolver` after the install. Before the install, that command fails with `ENOMATCH`, so write `"allowScripts": { "unrs-resolver": false }` into `package.json` instead.

### TypeScript version

eslint-config and tsconfig need `typescript` `~6.0.3`. TypeScript 7 is not supported right now, and neither is TypeScript 6.1 or later, since typescript-eslint supports nothing after 6.0.

Install it as `typescript@~6.0.3`. An unpinned `typescript` installs the latest version, and `typescript@6` saves `^6.0.3`, which admits 6.1. With either, eslint-config's `defineConfig` throws, and npm fails with `ERESOLVE`.

### Options the config packages share

Some option names mean different things in each config package:

| Option | eslint-config | prettier-config | stylelint-config |
| --- | --- | --- | --- |
| `root` | Required: the absolute path of an existing folder. Relative paths and globs resolve from it | Optional. A relative `tailwindcss.entryPoint`, dot-prefixed plugin paths and bare plugin names resolve from it | Required: the absolute path of an existing folder. Relative paths, globs and module names resolve from it |
| `tailwindcss` | `{ entryPoint }`; `true` throws | `true` or `{ entryPoint }` | `true` or `{ entryPoint }` |
| `tailwindcss.entryPoint`, the Tailwind CSS v4 entry stylesheet | Required. A path relative to `root`, an absolute path, or a `file:` URL or URL string, such as `import.meta.resolve('./src/styles.css')` | Optional; without it, classes sort by Tailwind's default theme. An absolute path, a `file:` URL or URL string, or a relative path | Optional. A path relative to `root`, an absolute path, or a `file:` URL or URL string |
| `astro` | Off by default | Off by default | On by default, so the Astro recipe doesn't set it |
| `html` | Off by default | n/a | On by default |
| `markdown: false` | Turns Markdown linting off | Throws, as `markdown: true` does: `markdown` takes Prettier options. List the files in `.prettierignore` to leave them unformatted | Turns linting of styles in Markdown files off |
| What `defineConfig` returns | A composer, which ESLint awaits as a promise of the configs | A config object, synchronously | A promise, exported without `await` |

## Setup recipes

Write a recipe's files in the project's folder, and add the scripts of [Running the fixers][]. A block's first-line comment, such as `// eslint.config.mjs`, names the file and isn't part of it. Each package's README covers the other options.

The recipes use pnpm. With npm, install with `npm i -D`, write `npm run` for `pnpm` in the scripts, and leave out `pnpm-workspace.yaml`, as [Supported setups](#supported-setups) explains.

### A minimal project

A TypeScript project, with Prettier's and Stylelint's static default configs:

```sh
pnpm add -D @gpahal/eslint-config @gpahal/prettier-config @gpahal/stylelint-config @gpahal/tsconfig \
  eslint prettier stylelint typescript@~6.0.3 @types/node@24
```

```yaml
# pnpm-workspace.yaml
allowBuilds:
  unrs-resolver: false
```

```json
// package.json
{
  "private": true,
  "type": "module",
  "prettier": "@gpahal/prettier-config",
  "scripts": { "check:types": "tsc --noEmit" }
}
```

```text
# .gitignore
node_modules
*.tsbuildinfo
```

```js
// stylelint.config.mjs
export default { extends: ['@gpahal/stylelint-config'] }
```

```js
// eslint.config.mjs
import { defineConfig } from '@gpahal/eslint-config'

export default defineConfig({ root: import.meta.dirname })
```

```json
// tsconfig.json
{
  "extends": "@gpahal/tsconfig/base",
  "compilerOptions": { "types": ["node"] },
  "include": ["src", "*.config.ts"]
}
```

The tsconfig includes the root config files, such as `vitest.config.ts`, so `tsc` checks them too. ESLint's `node` preset stays off; turn it on with `node: true` when Node runs the code, or limit it to some files with `scope`, as in [A pnpm monorepo](#a-pnpm-monorepo).

The static configs take no options, and each tool merges your settings over them its own way, as the last rows of [Lists and merging][] say. Switch to the package's `defineConfig` for options with paths, such as a Tailwind entry stylesheet or Stylelint's reference files, and for the Astro and Tailwind integrations. ESLint has no static config, since it needs `root`.

### A pnpm monorepo

One ESLint config at the workspace root lints every package, as eslint-config's [Set up a monorepo](packages/eslint-config/README.md#set-up-a-monorepo) explains. Here `packages/core` is a published library without Node's APIs, bundled by tsdown, and `packages/cli` a Node command line tool. With npm, leave out `-w`, and list the packages in `package.json`'s `workspaces` instead of `pnpm-workspace.yaml`:

```sh
pnpm add -D -w @gpahal/eslint-config @gpahal/prettier-config @gpahal/stylelint-config @gpahal/tsconfig \
  eslint prettier stylelint typescript@~6.0.3 @types/node@24 tsdown
```

```yaml
# pnpm-workspace.yaml
packages:
  - packages/*
allowBuilds:
  unrs-resolver: false
```

```json
// package.json
{
  "private": true,
  "type": "module",
  "prettier": "@gpahal/prettier-config",
  "scripts": { "check:types": "tsc -b" }
}
```

```text
# .gitignore
node_modules
dist
*.tsbuildinfo
```

```js
// stylelint.config.mjs
export default { extends: ['@gpahal/stylelint-config'] }
```

```js
// eslint.config.mjs
import { defineConfig } from '@gpahal/eslint-config'

export default defineConfig({
  root: import.meta.dirname,
  node: { scope: ['packages/cli/**'] },
  typescript: { library: true },
  configs: [{ files: ['packages/cli/**'], rules: { 'no-console': 'off' } }],
}).override('gpahal/typescript/library', { files: ['packages/core/src/**/*.ts'] })
```

```json
// tsconfig.json
{
  "files": [],
  "references": [
    { "path": "./packages/core" },
    { "path": "./packages/cli" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

```json
// tsconfig.node.json
{
  "extends": ["@gpahal/tsconfig/base", "@gpahal/tsconfig/node"],
  "compilerOptions": { "allowJs": true, "checkJs": true, "incremental": true },
  "include": ["*.config.*", "packages/*/*.config.*"]
}
```

```json
// packages/core/package.json
{
  "name": "@acme/core",
  "version": "0.1.0",
  "description": "Sums numbers",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/you/acme.git",
    "directory": "packages/core"
  },
  "license": "MIT",
  "author": "Your Name <you@example.com>",
  "sideEffects": false,
  "type": "module",
  "exports": { ".": "./dist/index.mjs", "./package.json": "./package.json" },
  "files": ["dist"],
  "scripts": { "build": "tsdown" }
}
```

```json
// packages/core/tsconfig.json
{
  "extends": ["@gpahal/tsconfig/base", "@gpahal/tsconfig/library", "@gpahal/tsconfig/erasable"],
  "compilerOptions": { "incremental": true },
  "include": ["src", "tsdown.config.ts"]
}
```

```ts
// packages/core/tsdown.config.ts
import type { UserConfig } from 'tsdown'

const config: UserConfig = { entry: ['src/index.ts'] }

export default config
```

```json
// packages/cli/package.json
{
  "name": "@acme/cli",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24.22.0" }
}
```

```json
// packages/cli/tsconfig.json
{
  "extends": ["@gpahal/tsconfig/base", "@gpahal/tsconfig/node"],
  "compilerOptions": { "incremental": true },
  "include": ["src"]
}
```

The root `tsconfig.json` is a solution: `"files": []` keeps it from checking files itself, and `tsc -b`, ESLint and editors follow its `references`. `tsconfig.node.json` types the config files with Node's types, and only `packages/cli` gets Node's types and eslint-plugin-n's rules, which check the Node APIs it uses against its `engines.node`. Install the `@types/node` of that Node version. For packages that import each other, make them composite projects, as [tsconfig's monorepo recipe](packages/tsconfig/README.md#a-monorepo-of-composite-projects) shows.

Without `"private": true`, `packages/core/package.json` gets eslint-plugin-package-json's publishing checks, which require `description`, `license`, `author`, `repository` and `sideEffects`. `typescript.library` reports exports without declared types, and the `.override()` limits it to core's sources. Core's tsconfig adds `library`, whose `isolatedDeclarations` needs the declared type of `tsdown.config.ts`'s default export, and `erasable`, which rejects syntax that Node's type stripping can't erase, such as enums. The config imports only tsdown's types, since `import-x/no-extraneous-dependencies` reads core's `package.json`, which doesn't list the root's tsdown. [tsconfig's library recipes](packages/tsconfig/README.md#a-library-built-by-a-bundler) add tests and other hosts.

### Vite with React

This recipe adds the tools to an app from create-vite's `react-ts` template and replaces its three tsconfigs. Delete the template's `eslint.config.js`, which ESLint would load instead of `eslint.config.mjs`:

```sh
pnpm add -D @gpahal/eslint-config @gpahal/prettier-config @gpahal/stylelint-config @gpahal/tsconfig \
  eslint prettier stylelint typescript@~6.0.3 @types/node@24 \
  @eslint-react/eslint-plugin eslint-plugin-react-hooks eslint-plugin-jsx-a11y-x eslint-plugin-react-refresh
```

```yaml
# pnpm-workspace.yaml
allowBuilds:
  unrs-resolver: false
```

```json
// package.json
{
  "private": true,
  "type": "module",
  "prettier": "@gpahal/prettier-config",
  "scripts": { "check:types": "tsc -b" }
}
```

```js
// stylelint.config.mjs
export default { extends: ['@gpahal/stylelint-config'] }
```

```js
// eslint.config.mjs
import { defineConfig } from '@gpahal/eslint-config'

export default defineConfig({
  root: import.meta.dirname,
  react: true,
  browser: { files: ['src/**'] },
})
```

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

`tsconfig.app.json` types the app for the browser, with Vite's client types and without Node's. `tsconfig.node.json` types the root `*.config.*` files with Node's. Add `*.tsbuildinfo` to the template's `.gitignore`, since `tsc -b` writes one per project. [tsconfig's recipe](packages/tsconfig/README.md#root-config-files-of-a-react-or-astro-app) explains the options.

`browser.files` reports Node's globals, such as `process`, in the app's code, and confusing browser globals, such as `top` and `length`, which need `globalThis.`. [eslint-config's Vite recipe](packages/eslint-config/README.md#vite-with-react-vitest-and-tailwind-css) lists what it reports in the template's own code, such as `unicorn/filename-case` on `App.tsx`.

For Tailwind CSS through `@tailwindcss/vite`, also install `eslint-plugin-better-tailwindcss` and `prettier-plugin-tailwindcss`. Delete the `"prettier"` key from `package.json`, which Prettier reads before `prettier.config.mjs`, write the Prettier and Stylelint configs with `defineConfig`, as the [Next.js recipe](#nextjs-with-tailwind-css) does, and pass `tailwindcss: { entryPoint: 'src/index.css' }` to all three configs.

### Next.js with Tailwind CSS

This recipe adds the tools to an app from create-next-app with TypeScript, Tailwind CSS and the App Router, without its ESLint setup:

```sh
pnpm add -D @gpahal/eslint-config @gpahal/prettier-config @gpahal/stylelint-config @gpahal/tsconfig \
  eslint prettier stylelint typescript@~6.0.3 @types/node@24 \
  @eslint-react/eslint-plugin eslint-plugin-react-hooks eslint-plugin-jsx-a11y-x eslint-plugin-react-refresh \
  @next/eslint-plugin-next eslint-plugin-better-tailwindcss prettier-plugin-tailwindcss
```

```yaml
# pnpm-workspace.yaml
allowBuilds:
  unrs-resolver: false
```

```json
// package.json
{
  "private": true,
  "type": "module",
  "scripts": {
    "fix:eslint": "next typegen && eslint --fix .",
    "check:eslint": "next typegen && eslint --max-warnings 0 .",
    "check:types": "next typegen && tsc --noEmit"
  }
}
```

These scripts replace the `fix:eslint` and `check:eslint` of [Running the fixers][]. `next typegen` writes `next-env.d.ts` and the route types, such as `PageProps<'/blog/[slug]'>`, which a fresh checkout lacks; without them, the type-aware rules report every use as an error type.

```js
// eslint.config.mjs
import { defineConfig } from '@gpahal/eslint-config'

export default defineConfig({
  root: import.meta.dirname,
  nextjs: true,
  tailwindcss: { entryPoint: 'app/globals.css' },
})
```

`nextjs` turns on the `react` preset too, and `@gpahal/nextjs-server-component`, which reports browser globals and client-only hooks, such as `useState`, in route files without `'use client'`.

```js
// prettier.config.mjs
import { defineConfig } from '@gpahal/prettier-config'

export default defineConfig({ tailwindcss: { entryPoint: 'app/globals.css' } })
```

```js
// stylelint.config.mjs
import { defineConfig } from '@gpahal/stylelint-config'

export default defineConfig({
  root: import.meta.dirname,
  tailwindcss: { entryPoint: 'app/globals.css' },
  referenceFiles: ['app/fonts.css'],
})
```

```css
/* app/fonts.css */
:root {
  --font-geist-sans: initial;
  --font-geist-mono: initial;
}
```

`next/font` sets the Geist font properties that `app/globals.css` uses at runtime, so Stylelint's `no-unknown-custom-properties` would report them. `app/fonts.css` declares them for Stylelint only; nothing imports it.

```json
// tsconfig.json
{
  "extends": "@gpahal/tsconfig/nextjs-app",
  "compilerOptions": { "paths": { "@/*": ["./*"] } }
}
```

`nextjs-app` sets no `paths`, so the tsconfig keeps create-next-app's `@/*` alias. It lists `node` in `types`, and its project includes the root config files, such as `next.config.ts`. [eslint-config's Next.js recipe](packages/eslint-config/README.md#nextjs) lists what it reports in the starter's own code.

### Astro with React, Tailwind CSS and Vitest

This recipe adds the tools to an Astro app set up with `astro add react tailwind`, so its command doesn't install Astro, React or Tailwind CSS. Omit the presets you don't use.

```sh
pnpm add -D @gpahal/eslint-config @gpahal/prettier-config @gpahal/stylelint-config @gpahal/tsconfig \
  eslint prettier stylelint typescript@~6.0.3 @types/node@24 @astrojs/check \
  @eslint-react/eslint-plugin eslint-plugin-react-hooks eslint-plugin-jsx-a11y-x eslint-plugin-react-refresh \
  eslint-plugin-astro eslint-plugin-better-tailwindcss prettier-plugin-astro prettier-plugin-tailwindcss \
  @vitest/eslint-plugin vitest
```

```yaml
# pnpm-workspace.yaml
allowBuilds:
  unrs-resolver: false
```

```json
// package.json
{
  "private": true,
  "type": "module",
  "scripts": {
    "fix:eslint": "astro sync && eslint --fix .",
    "check:eslint": "astro sync && eslint --max-warnings 0 .",
    "check:types": "astro check"
  }
}
```

These scripts replace the `fix:eslint` and `check:eslint` of [Running the fixers][]. `astro sync` writes `.astro/types.d.ts`, which `tsconfig.json` includes and a fresh checkout lacks.

```js
// eslint.config.mjs
import { defineConfig } from '@gpahal/eslint-config'

export default defineConfig({
  root: import.meta.dirname,
  react: { scope: ['src/components/**'] },
  astro: true,
  tailwindcss: { entryPoint: 'src/styles/global.css' },
  vitest: true,
  browser: { files: ['src/components/**'] },
  server: { files: ['src/pages/api/**'] },
})
```

`scope` limits a preset to some files, here React to the components. `unicorn/filename-case` wants kebab-case file names, components included, so it reports `Counter.tsx`: name it `counter.tsx`, or allow both cases with `unicorn: { rules: { 'unicorn/filename-case': ['error', { cases: { kebabCase: true, pascalCase: true } }] } }`.

```js
// prettier.config.mjs
import { defineConfig } from '@gpahal/prettier-config'

export default defineConfig({
  astro: true,
  tailwindcss: { entryPoint: 'src/styles/global.css' },
})
```

Without `root`, a relative `entryPoint` resolves from the folder of the config file Prettier finds for the formatted file, so set `root` when Prettier gets the config through `--config` or an editor setting.

```js
// stylelint.config.mjs
import { defineConfig } from '@gpahal/stylelint-config'

export default defineConfig({
  root: import.meta.dirname,
  tailwindcss: { entryPoint: 'src/styles/global.css' },
  referenceFiles: ['src/styles/tokens.css'],
})
```

Export Stylelint's `defineConfig` promise without `await`, so that Stylelint shows its errors. It adds the Tailwind entry stylesheet, the files it imports and Tailwind's `theme.css` to the reference files.

```css
/* src/styles/tokens.css */
:root {
  --space: 1rem;
}
```

`referenceFiles` lists the files that define custom properties outside Tailwind's theme. A path that isn't a glob must exist.

```json
// tsconfig.json
{
  "extends": "@gpahal/tsconfig/astro-app",
  "compilerOptions": { "jsxImportSource": "react" },
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

`jsxImportSource` checks the React islands against React's JSX. Without it, `astro-app`'s `jsx: preserve` finds the global `React` namespace only while some file imports `react`; with none, every tag fails with TS7026.

`astro-app` lists no `types`, so tests import Vitest's functions, as in `import { describe, expect, it } from 'vitest'`; `vitest/globals` in `types` would reach the islands too. Node's types reach the app anyway, through Astro's client types, so `process.env.X` type-checks in an island.

`astro-app` excludes `dist`, `build`, `out`, `coverage` and the root `*.config.*` files, which [need their own tsconfig](packages/tsconfig/README.md#root-config-files-of-a-react-or-astro-app):

```json
// tsconfig.node.json
{
  "extends": ["@gpahal/tsconfig/base", "@gpahal/tsconfig/node"],
  "compilerOptions": {
    "composite": true,
    "noEmit": false,
    "emitDeclarationOnly": true,
    "outDir": "node_modules/.tmp/tsconfig.node",
    "allowJs": true,
    "checkJs": true,
    "allowImportingTsExtensions": true
  },
  "include": ["*.config.*"]
}
```

`tsconfig.json` references `tsconfig.node.json`, so editors, ESLint and `astro check` type the root config files with Node's types. A tsconfig with files of its own can reference only a `composite` project that emits (TS6306, TS6310), so this one writes its output to `node_modules/.tmp`, where nothing reads it. The app stays in `tsconfig.json` rather than behind a solution's references, since astro-eslint-parser types `.astro` files with their folder's `tsconfig.json` and doesn't follow references.

### Running the fixers

Run the fixers in this order:

1. `eslint --fix`: its fixes can leave code for Prettier to lay out.
2. `prettier --write`.
3. `stylelint --fix`: on Prettier's output, its fixes mostly settle in one pass. `word-wrap` becomes `overflow-wrap`, and beside an existing `overflow-wrap` the duplicate goes only on the next run. With different values, as in `overflow-wrap: anywhere; word-wrap: break-word`, the fix leaves two `overflow-wrap` declarations that nothing reports, so remove one yourself.
4. `prettier --write` again, to lay out what Stylelint's fixes changed.

```json
{
  "scripts": {
    "fix:eslint": "eslint --fix .",
    "fix:prettier": "prettier --write .",
    "fix:stylelint": "stylelint --fix --allow-empty-input --ignore-path .gitignore \"**/*.{css,astro,html,md,markdown}\"",
    "fix": "pnpm fix:eslint; e=$?; pnpm fix:prettier; p=$?; pnpm fix:stylelint; s=$?; pnpm fix:prettier; q=$?; exit $((e || p || s || q))",
    "check:eslint": "eslint --max-warnings 0 .",
    "check": "pnpm check:eslint && prettier --check . && stylelint --allow-empty-input --ignore-path .gitignore \"**/*.{css,astro,html,md,markdown}\" && pnpm check:types"
  }
}
```

`fix` runs every step even when one fails, and fails if any did; it needs a POSIX shell. `check` runs the linters and formatter, then the recipe's `check:types`.

The Stylelint commands read `.gitignore`, so the project needs one, and `--allow-empty-input` lets them pass without any styled files. Stylelint runs without `--max-warnings 0`, so `plugin/use-baseline`'s warnings don't fail the check.

Stylelint's summary calls every report of a fixable rule "potentially fixable with the --fix option", but the preset makes `order/properties-order`, `property-no-vendor-prefix` and `value-no-vendor-prefix` report-only, so fix those by hand.

## Editor setup

In VS Code, with the ESLint, Stylelint and Prettier extensions:

```json
// .vscode/settings.json
{
  "eslint.validate": [
    "javascript",
    "javascriptreact",
    "typescript",
    "typescriptreact",
    "astro",
    "html",
    "markdown",
    "json",
    "jsonc",
    "yaml",
    "toml"
  ],
  "stylelint.validate": ["css", "postcss", "astro", "html", "markdown"],
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": { "source.fixAll.eslint": "explicit" }
}
```

The ESLint extension's default languages leave out `yaml` and `toml`, and the Stylelint extension's leave out Astro, HTML and Markdown. With the GitHub Actions extension, add `github-actions-workflow` to `eslint.validate` too, and add `json5` when an extension gives `.json5` files that language. `toml` needs an extension, such as Even Better TOML, set as `"[toml]": { "editor.defaultFormatter": "tamasfe.even-better-toml" }`, since Prettier can't format TOML.

On save, VS Code runs ESLint's fixes, then Prettier. `"source.removeUnusedImports": "explicit"` in `editor.codeActionsOnSave` also removes unused imports, which ESLint only reports.

In Zed, add ESLint to Astro, HTML, Markdown, YAML, TOML and JSON, and run its fixes on format before Prettier. TOML files need Zed's TOML extension.

```jsonc
// .zed/settings.json
{
  "languages": {
    "Astro": { "language_servers": ["astro-language-server", "eslint", "..."] },
    "HTML": { "language_servers": ["eslint", "..."] },
    "Markdown": { "language_servers": ["eslint", "..."] },
    "YAML": { "language_servers": ["eslint", "..."] },
    "TOML": { "language_servers": ["eslint", "..."] },
    "JSON": { "language_servers": ["eslint", "..."] },
    "JSONC": { "language_servers": ["eslint", "..."] },
  },
  "code_actions_on_format": { "source.fixAll.eslint": true },
  "format_on_save": "on",
}
```

In Neovim 0.11 or later, install nvim-lspconfig, `vscode-langservers-extracted` and `@stylelint/language-server`, then extend both servers' file types:

```lua
-- init.lua
vim.lsp.config('eslint', {
  filetypes = {
    'javascript', 'javascriptreact', 'typescript', 'typescriptreact', 'astro',
    'html', 'markdown', 'json', 'jsonc', 'yaml', 'toml',
  },
})
vim.lsp.config('stylelint_lsp', {
  filetypes = { 'css', 'astro', 'html', 'markdown' },
  settings = { stylelint = { validate = { 'css', 'postcss', 'astro', 'html', 'markdown' } } },
})
vim.lsp.enable({ 'eslint', 'stylelint_lsp' })
```

`:LspEslintFixAll` and `:LspStylelintFixAll` apply fixes. Format with Prettier through a plugin such as conform.nvim.

After adding or renaming a config file, restart ESLint's server, as [The editor shows stale ESLint results](#the-editor-shows-stale-eslint-results) explains.

## Adopt in an existing codebase

Every rule the presets turn on is an error, except the warnings `vitest/no-disabled-tests` and Stylelint's `plugin/use-baseline`, so the first run can report hundreds of problems. Turn off the conventions you won't adopt before running the fixers, since a fix stays in the tree after you turn its rule off:

1. Prepare the project:
   - Get every TypeScript file into a tsconfig, or list the stragglers in `typeAware.allowDefaultProject`.
   - Clear the [`GPAHAL_…` warnings](#a-gpahal_-warning).
   - Ignore generated files in ESLint's `ignores` and in `.prettierignore`, so `fix` doesn't rewrite them.
   - Remove or rename the old config's directives that name rules these presets don't load.
   - Extend `@gpahal/tsconfig/base`, or at least set `noUncheckedIndexedAccess`, before acting on type-aware reports. Without it, `@typescript-eslint/no-unnecessary-condition` reports a needed `record[key] === undefined` check, and removing it changes what the code does.
2. See which rules report most. This records every report in `eslint-suppressions.json`, prints the 15 rules with the most, then deletes the file:

   ```sh
   eslint --suppress-all . && node -e 'const s=require("./eslint-suppressions.json"),c={};for(const f in s)for(const r in s[f])c[r]=(c[r]??0)+s[f][r].count;console.table(Object.entries(c).sort((a,b)=>b[1]-a[1]).slice(0,15))' && rm eslint-suppressions.json
   ```

3. Turn off the conventions you won't adopt, as in the config below. Ones that often report on existing code are `@typescript-eslint/array-type`, `@typescript-eslint/method-signature-style`, `@typescript-eslint/consistent-type-definitions`, `unicorn/filename-case`, `@gpahal/comment-layout`, `vitest/consistent-test-it` and `prefer-template`. `@typescript-eslint/no-floating-promises` also reports `onClick={() => void save()}`; write `save().catch(report)`.
4. Run `fix` from [Running the fixers][]. Rules whose fixes can change behavior only report; eslint-config lists them in [Report-only fixes](packages/eslint-config/README.md#report-only-fixes).
5. Record the remaining reports with `eslint --suppress-all .`, and with the Stylelint command of `check` plus `--suppress`, then fix them over time.

```js
// eslint.config.mjs
import { defineConfig, files } from '@gpahal/eslint-config'

export default defineConfig({
  root: import.meta.dirname,
  typescript: {
    rules: {
      '@typescript-eslint/array-type': 'off',
      '@typescript-eslint/method-signature-style': 'off',
      '@typescript-eslint/consistent-type-definitions': 'off',
    },
  },
  unicorn: { rules: { 'unicorn/filename-case': 'off' } },
  commentLayout: false,
  configs: [{ files: [...files.test], rules: { 'unicorn/prefer-https': 'off' } }],
})
```

The last config turns a rule off only in test files, as [Turn a rule off for tests](packages/eslint-config/README.md#turn-a-rule-off-for-tests) explains.

`--fix` leaves `@gpahal/comment-layout`'s suggestions, which can be most of its reports, since a `//` comment above a declaration may be a section label rather than its doc. Apply them in an editor, or keep the rule off until you do.

Once you fix a suppressed problem, every ESLint run fails until `eslint --prune-suppressions .` drops the stale entry. To prune as you fix, write `eslint --fix --prune-suppressions .` in `fix:eslint`. Stylelint's suppressions are experimental and have no prune, and running `--suppress` again records new problems too.

Stylelint's `order/properties-order` reports without fixing, since reordering can change which of two declarations wins. To fix it with the preset's order, set it to `[undefined, { disableFix: false }]` in the `rules` of Stylelint's `defineConfig`. In a static config that extends the preset, give the full setting instead, with `stylelint-config-recess-order` installed:

```js
// stylelint.config.mjs
import recessOrder from 'stylelint-config-recess-order/groups'

export default {
  extends: ['@gpahal/stylelint-config'],
  rules: { 'order/properties-order': [recessOrder, { disableFix: false }] },
}
```

Review the fix's diff, since a shorthand that moves past its longhand changes the result.

## Troubleshooting

ESLint's own errors and warnings are in [eslint-config's troubleshooting](packages/eslint-config/README.md#troubleshooting).

### `needs typescript ~6.0.3`, or `ERESOLVE`

eslint-config's `defineConfig` throws `needs typescript ~6.0.3`, and npm fails with `ERESOLVE`, when the project requests a TypeScript other than `~6.0.3`. TypeScript 7 is not supported right now. Install `typescript@~6.0.3`, as [TypeScript version](#typescript-version) says.

### `ERR_PNPM_IGNORED_BUILDS`

pnpm 12 fails an install until `pnpm-workspace.yaml` allows or skips the build script of each package the error names. `unrs-resolver: false` skips the one eslint-config brings, which linting doesn't need. Storybook brings esbuild's, which only fetches a binary that pnpm already installs, so skip it too. Check what any other script does before you allow or skip it.

```yaml
# pnpm-workspace.yaml
allowBuilds:
  esbuild: false
  unrs-resolver: false
```

### `ERR_REQUIRE_ASYNC_MODULE` from Stylelint

The Stylelint config exports `await defineConfig(...)`, and `defineConfig` rejected an option. Stylelint then shows this error instead of the option's. Export `defineConfig(...)` without `await` to see the option's error.

### The editor shows stale ESLint results

ESLint's server finds the config files that no tsconfig includes when it loads the config, and keeps that config while it runs. After adding or renaming a config file, or when an error says the config changed in this process, restart the server: **ESLint: Restart ESLint Server** in VS Code, `:lsp restart eslint` in Neovim 0.12, or `:LspRestart` in 0.11.

### A `GPAHAL_…` warning

eslint-config reports setup problems as Node warnings with `GPAHAL_` codes, such as `(node:1234) [GPAHAL_FRAMEWORK_OPTION_UNSET] Warning: …`, each saying how to fix the setup. To silence one, set its code to `false` in eslint-config's `warnings` option, which also reaches editors:

```js
// eslint.config.mjs
import { defineConfig } from '@gpahal/eslint-config'

export default defineConfig({
  root: import.meta.dirname,
  warnings: { GPAHAL_FRAMEWORK_OPTION_UNSET: false, GPAHAL_COMMONJS_PACKAGE: false },
})
```

[eslint-config's troubleshooting](packages/eslint-config/README.md#warnings) lists the codes. In a terminal, Node's `--disable-warning=<code>` in `NODE_OPTIONS` works too, but an editor's ESLint server doesn't inherit `NODE_OPTIONS`.

prettier-config warns with `GPAHAL_PRETTIER_OLD_PRETTIER` and `GPAHAL_PRETTIER_UNTESTED_TAILWIND_PLUGIN`. It has no `warnings` option, so silence them with `--disable-warning` in `NODE_OPTIONS`.

## Install hardening

This repository's `pnpm-workspace.yaml` settings don't publish. These pnpm settings guard a project's install:

```yaml
# pnpm-workspace.yaml
minimumReleaseAge: 4320
minimumReleaseAgeExclude:
  - '@gpahal/*'
trustPolicy: no-downgrade
trustPolicyIgnoreAfter: 43200
allowBuilds:
  unrs-resolver: false
```

`minimumReleaseAge` holds back versions newer than 3 days, in minutes, to leave time to catch a compromised release. `trustPolicy: no-downgrade` fails an install of a version published with weaker provenance than an earlier one, a sign of a takeover. `trustPolicyIgnoreAfter` exempts versions older than 30 days, such as `semver@6.3.1`, which fail the check otherwise. Before pnpm 12, also set `blockExoticSubdeps: true` to refuse dependencies of dependencies from git or tarball URLs.

An audit of a fresh install reports two advisories:

- [GHSA-238p-pmpm-9mq7](https://github.com/advisories/GHSA-238p-pmpm-9mq7), in KaTeX's renderer, which eslint-config installs through `micromark-extension-math` but never runs. To clear it, add `katex@>=0.11.0 <0.18.2: ^0.18.2` under `overrides` in `pnpm-workspace.yaml`, or with npm, `"overrides": { "katex": "^0.18.2" }` in `package.json`.
- [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), in braces, which expands the globs you write, not the files linted. Validate untrusted globs before passing them to Stylelint or stylelint-config's options.

## Lists and merging

Every list option that takes a function takes an array too. An array replaces the option's defaults. A function gets a copy of them, or `[]` for an option without defaults, and returns the list to use.

These lists may be empty, which removes the defaults: ESLint's `ignores`, `typeAware.ignores` and `typeAware.allowDefaultProject`, Prettier's `tailwindcss.functions`, `tailwindcss.attributes` and `sortImports.importOrder`, and Stylelint's `tailwindcss.functions`, `tailwindcss.atRules` and `ignoreFiles`. The others throw when empty.

| Package | Option | Defaults | Notes |
| --- | --- | --- | --- |
| eslint-config | [`ignores`][ESLint ignores] | Build output, generated files, lockfiles | ESLint still ignores `node_modules` and `.git`, and `gitignore` adds the `.gitignore` globs. |
| eslint-config | [`testFiles`][ESLint ignores] | Test files and folders | Must list a glob that can match a code file. Can't be empty. Only code files among its matches get the test rules. |
| eslint-config | [`vitest.files`][ESLint lists] | `testFiles` | Can't be empty; turn the preset off instead. Its files get every test exemption too. Only code files among its matches get Vitest's rules. With `playwright` on, the files of `playwright.files` are left out, after a function runs; Playwright's `!` exclusions stay Vitest's. |
| eslint-config | [`playwright.files`][ESLint lists] | Code files in `e2e` and `playwright` folders, and `*.e2e.*` files | Can't be empty; turn the preset off instead. Its files get every test exemption too. Only code files among its matches get Playwright's rules. |
| eslint-config | [`storybook.files`][ESLint lists] | `*.stories.*` files, and code files in `.storybook` folders | Can't be empty; turn the preset off instead. Only code files among its matches get Storybook's rules. |
| eslint-config | [`commonjs.files`][ESLint lists] | `**/*.js` | Can't be empty; turn the preset off instead. A glob applies only to its `.js` files, and one that can't match a `.js` file throws. |
| eslint-config | [`typeAware.allowDefaultProject`](packages/eslint-config/README.md#typed-config-files) | Config files that no tsconfig lists | May be empty. An array counts matching files toward the limit. A function's result counts its literal paths, and the config and code files outside dot folders that its other globs match. |
| eslint-config | [`typeAware.ignores`](packages/eslint-config/README.md#lint-some-files-without-type-information) | None | May be empty. Otherwise it must list a glob that can match a code file, besides any `!` globs. A leading `./` is dropped. |
| eslint-config | [`browser.files`, `server.files`][ESLint lists] | None | Must list a glob, so it can't be empty; turn the preset off instead. |
| eslint-config | [`scope`](packages/eslint-config/README.md#limit-a-preset-to-part-of-a-monorepo) | The preset's files | An array only. Can't be empty; turn the preset off instead. |
| font-fallback | [`fallbacks`](packages/font-fallback/README.md#other-fallbacks) | The category's fonts | An array only. Can't be empty. |
| prettier-config | [`tailwindcss.functions`][Prettier helpers] | eslint-plugin-better-tailwindcss's helpers |  |
| prettier-config | [`tailwindcss.attributes`][Prettier helpers] | None | The plugin adds its own attributes, such as `class`, to the list. |
| prettier-config | [`sortImports.importOrder`](packages/prettier-config/README.md#set-the-import-order) | The preset's order |  |
| stylelint-config | [`tailwindcss.functions`, `tailwindcss.atRules`](packages/stylelint-config/README.md#add-a-tailwind-function-or-at-rule) | Tailwind's functions and at-rules |  |
| stylelint-config | [`ignoreFiles`](packages/stylelint-config/README.md#ignore-files) | None | Takes a single glob too. The list then merges with disabled file types' and extended configs' ignore lists, keeping each normalized glob's last occurrence. |

`defineConfig`, `mergeConfigs` and the ESLint composer merge configs and settings as follows. The static default configs merge the tool's own way, as their rows say.

| Package | What | How |
| --- | --- | --- |
| eslint-config | [`configs`, `.append()`, `.insertBefore()`, `.insertAfter()`][ESLint composer] | Configs share validation and scoping: each is split into one config per scope, keeping its `name`, and the last config wins. |
| eslint-config | [`.override(name, config)`][ESLint composer] | Selected objects merge into named configs; other keys replace. |
| eslint-config | [`.overrideRules(rules)`][ESLint composer] | Changes enabled rules while preserving options for severity-only entries. |
| prettier-config | [`mergeConfigs(a, b)`](packages/prettier-config/README.md#merge-with-another-config) | Later options win, and overrides concatenate. Plugins deduplicate, with Tailwind's after the others except `prettier-plugin-classnames` and `prettier-plugin-merge`, as with [`tailwindcss`](packages/prettier-config/README.md#options). A plugin given by name that a `defineConfig` config adds itself throws. An override's plugins add to the merged config's. |
| prettier-config | [`options`, `overrides`](packages/prettier-config/README.md#change-an-option) | Options override defaults, file presets override options, and user overrides come last, and their plugins add to the preset's. |
| stylelint-config | [`rules`, override `rules`](packages/stylelint-config/README.md#rule-merging) | Your settings merge over the preset's settings for each file type. |
| stylelint-config | [`plugins`, `extends`, `overrides`][Stylelint options] | Extended configs load recursively, following Stylelint's precedence. Their rules and overrides beat the preset's, except those of the configs the preset builds on, such as stylelint-config-standard, which are skipped. Your `rules` merge over theirs. |
| stylelint-config | [`languageOptions`][Stylelint overrides] | Deeply merges preset, extended, user and override settings, in that order. |
| stylelint-config | [`referenceFiles`][Stylelint overrides] | Lists extended entries, then yours, Tailwind's and the override's. |
| stylelint-config | [Disable-report settings][Stylelint options] | Your settings beat extended configs, which beat the preset. |
| prettier-config | [The static default config](packages/prettier-config/README.md#quick-start) | Prettier's merging: a config that spreads it replaces the options it sets, including the whole `overrides` list, so spread `prettierConfig.overrides` into yours, and an override's `plugins` replace the config's in its files. |
| stylelint-config | [The default exports under `extends`](packages/stylelint-config/README.md#quick-start) | Stylelint's merging: a rule you set replaces the preset's whole setting. |
| tsconfig | [`extends`](packages/tsconfig/README.md#libs-and-types) | Later presets win, replacing earlier lists. |

## Development

You need Node 24.22 or later and the pnpm version in `package.json`'s `packageManager` field.

```sh
pnpm install
pnpm build
pnpm check
```

Build first: the packages resolve each other through their gitignored `build/` folders. `pnpm check` runs every gate but the canaries, tests that fail once upstream fixes a bug that a workaround exists for; `pnpm turbo run test-canaries` runs them. [CI](.github/workflows/ci.yml) runs the tasks of both in five parallel jobs, typecheck, lint, test, test-canaries and test-recipes, each with a Turbo cache of its own, and `pnpm audit --prod`, on Linux with read-only access and no secrets; a `check` job passes when they all do. `main` takes only squash-merged pull requests with signed commits and a passing `check`. A PR doesn't have to be up to date with `main`, but on a push to `main`, CI skips the checks only when a passing run on the merged PR's head tested the same files, which requires the PR to contain the latest `main`; see [gpahal/ci](https://github.com/gpahal/ci). [AGENTS.md](AGENTS.md) covers contributor conventions.

## Releasing

Changesets version and publish the packages:

1. `pnpm cs` adds a changeset interactively, then applies all pending changesets, bumping the versions of the packages they name. `changelog` is off in `.changeset/config.json`, so no `CHANGELOG.md` is written and a changeset's text is discarded. Commit the result on a branch, open a pull request and squash-merge it once `check` passes.
2. `pnpm cs-publish` publishes from a clean tree, with no untracked or ignored files under `packages/*/src`, with the `main` branch checked out at the commit of `origin/main`, once the latest `check` run on GitHub for that commit has passed. It reads that run with `gh`, which must be logged in, and runs no gates locally. It builds, then runs `changeset publish --no-git-tag`, which skips versions npm already has and creates no git tags, so nothing is tagged locally or pushed to the remote.

A bump of `@gpahal/std` also bumps every package that depends on it through `workspace:*`. `@gpahal/internal` is bundled and bumps nothing, so name the packages that bundle it in the changeset.

Each published package's `prepublishOnly` fails outside `pnpm cs-publish`, since npm would publish `workspace:*` dependencies as they are and leave out the `LICENSE` symlink. Publishing uses the owner's local npm token, so the packages carry no npm provenance.

## License

Licensed under the MIT license ([LICENSE](LICENSE) or [opensource.org/licenses/MIT](https://opensource.org/licenses/MIT)).

[ESLint composer]: packages/eslint-config/README.md#composer-methods
[ESLint ignores]: packages/eslint-config/README.md#add-ignores-and-test-files
[ESLint lists]: packages/eslint-config/README.md#lists-and-merging
[Lists and merging]: #lists-and-merging
[Prettier helpers]: packages/prettier-config/README.md#sort-classes-in-your-own-helpers
[Running the fixers]: #running-the-fixers
[Stylelint options]: packages/stylelint-config/README.md#options
[Stylelint overrides]: packages/stylelint-config/README.md#overrides
