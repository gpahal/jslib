# @gpahal/eslint-config

Composable flat ESLint config for TypeScript, React, Next.js, Astro, Tailwind CSS, Node, HTML, Turbo, Vitest, Playwright, Storybook, JSON, YAML, TOML and Markdown.

- [Install](#install)
- [Quick start](#quick-start)
- [Presets at a glance](#presets-at-a-glance)
- [Common tasks](#common-tasks)
- [Recipes](#recipes)
  - [Next.js](#nextjs)
  - [Vite with React, Vitest and Tailwind CSS](#vite-with-react-vitest-and-tailwind-css)
  - [A static site](#a-static-site)
  - [Storybook and Playwright](#storybook-and-playwright)
- [Migrating](#migrating)
- [Troubleshooting](#troubleshooting)
  - [Warnings](#warnings)
  - [Errors](#errors)
- [Reference](#reference)
  - [Setups][]
  - [Options][]
  - [Lists and merging][]
  - [Config order][]
  - [Composer methods][]
  - [Where your configs apply][]
  - [Preset scopes][]
  - [Browser and server code][]
  - [Typed config files][]
  - [Startup cost][]
  - [What's on by default](#whats-on-by-default)
  - [Duplicate rules][]
  - [Own rules](#own-rules)
  - [Markdown rules](#markdown-rules)
  - [Known issues](#known-issues)

## Install

```sh
pnpm add -D @gpahal/eslint-config eslint typescript@~6.0.3
```

Requires Node 24.22 or later and `eslint` `^10.11`. `typescript` `~6.0.3` is an optional peer that every project but a [JavaScript-only](#lint-a-javascript-project) one needs. TypeScript 7 is not supported right now. `defineConfig` checks the installed versions when the config loads and throws with the install command when one is missing or out of range, as in `peer dependencies: needs eslint ^10.11, but 10.0.0 is installed`. A newer ESLint loads with a `GPAHAL_PEER_NEWER_THAN_RANGE` warning.

The root README's [Supported setups](https://github.com/gpahal/jslib#supported-setups) explains why to pin `typescript@~6.0.3` and skip `unrs-resolver`'s build script with pnpm 12.

Each preset needs its plugins, which are optional peer dependencies with their ranges in `peerDependencies`:

| Option | Install |
| --- | --- |
| `react` | `@eslint-react/eslint-plugin`, `eslint-plugin-react-hooks`, `eslint-plugin-jsx-a11y-x`, and `eslint-plugin-react-refresh` unless `refresh` is `false` |
| `nextjs` | The `react` plugins and `@next/eslint-plugin-next` |
| `astro` | `eslint-plugin-astro`, and `eslint-plugin-jsx-a11y-x` where ESLint runs, since eslint-plugin-astro loads it from the working folder. In a monorepo linted from its root, install it at the root. Without it there, the `astro/jsx-a11y/*` rules are off, with a warning |
| `tailwindcss` | `eslint-plugin-better-tailwindcss`, `tailwindcss` |
| `html` | `@html-eslint/parser`, `@html-eslint/eslint-plugin` |
| `turbo` | `eslint-plugin-turbo` |
| `vitest` | `@vitest/eslint-plugin` |
| `playwright` | `eslint-plugin-playwright` |
| `storybook` | `eslint-plugin-storybook` |
| `antislop` | `eslint-plugin-slop`, unless `slop` is `false` |
| `node` | Nothing extra |

A missing plugin, or one older than its range, fails the config with an error that names the option and the install command. One newer than the range loads, with a warning once per version.

## Quick start

Install the base packages, Node's types and the plugins for the React and Vitest presets:

```sh
pnpm add -D @gpahal/eslint-config eslint typescript@~6.0.3 @types/node@24 @eslint-react/eslint-plugin \
  eslint-plugin-react-hooks eslint-plugin-jsx-a11y-x eslint-plugin-react-refresh @vitest/eslint-plugin
```

```js
// eslint.config.mjs
import { defineConfig } from '@gpahal/eslint-config'

export default defineConfig({
  root: import.meta.dirname,
  react: true,
  vitest: true,
  unicorn: { rules: { 'unicorn/filename-case': ['error', { case: 'camelCase' }] } },
  jsdoc: false,
})
```

```json
// tsconfig.json
{
  "compilerOptions": { "strict": true, "jsx": "react-jsx", "types": ["node"] },
  "include": ["src"]
}
```

`root` is the project folder, usually the config file's folder, and every path and glob option is relative to it. An area is one group of rules with its own option, such as `unicorn`: its `rules` reach every file the area lints, and `false` turns it off. Every rule the presets turn on is an error, including those that plugins' recommended configs set to `warn`, except `vitest/no-disabled-tests`, since a skipped test is often deliberate.

Type-aware linting needs a `tsconfig.json` that includes your TypeScript files. Config files that no tsconfig includes, such as `eslint.config.mjs`, get type information from the default project, so list `node` in `types`, as [Give config files Node types](#give-config-files-node-types) explains. Set `"type": "module"` in `package.json` too, or `defineConfig` warns that Node runs `.js` files as CommonJS.

The root README's [setup recipes](https://github.com/gpahal/jslib#setup-recipes) add Prettier, Stylelint and `@gpahal/tsconfig`, and [Recipes](#recipes) cover common frameworks.

## Presets at a glance

The presets are off by default. [Install](#install) lists each preset's plugins and [Options][] lists every option.

| Option | Default | Turns on | Sub-options and their defaults |
| --- | --- | --- | --- |
| `typeAware` | On | Type information from typescript-eslint's project service, and the rules that need it | `javascript: false`, so JavaScript files are linted without it. `allowDefaultProject`: the config files that no tsconfig includes, as [Typed config files][] explains |
| `typescript` | Always on | typescript-eslint's strict and stylistic type-checked configs | `library: false`: `true` requires declared types on exported functions and methods, as TypeScript's `isolatedDeclarations` does, outside tests, configs and scripts. `exhaustiveSwitch: 'strict'`: a `switch` over a union must list every member even with a `default` case; `'default'` lets `default` cover them. `strictBooleanExpressions: true`: no `any`, numbers or nullable strings or numbers in conditions. `rulesTypeAware`: rules for the files with type information |
| `imports` | On | eslint-plugin-import-x | `removeUnused: false`: `true` makes `--fix` remove unused imports, outside an editor. `cycles: false`: `true`, or `{ maxDepth }`, turns on `import-x/no-cycle` |
| `e18e` | On | @e18e/eslint-plugin | `modernization: true`, `performanceImprovements: true`, `moduleReplacements: false`: `true` turns on `e18e/ban-dependencies` |
| `markdown` | On | `.md` files and their code blocks | `math: false`: `true` parses `$` and `$$` math |
| `react` | Off | @eslint-react, React Hooks and jsx-a11y-x rules, and browser globals | `scope`: every React file. `refresh: true`: `react-refresh/only-export-components`, which keeps hot reloading working. `compiler`: detected; with it on, the React Compiler's rules run, such as `react-hooks/incompatible-library` |
| `nextjs` | Off | `react`, the Next.js recommended and Core Web Vitals rules, and `@gpahal/nextjs-server-component` | `scope`: `react.scope`. `rootDir: '.'`: the apps' folders, which set `scope` when it's unset |
| `astro` | Off | eslint-plugin-astro's recommended and jsx-a11y rules for `.astro` files | `rules` |
| `tailwindcss` | Off | eslint-plugin-better-tailwindcss | `entryPoint`: required, the Tailwind CSS entry stylesheet. `settings`: the plugin's other settings. `scope`: every code file, and `.astro` and `.html` files with `astro` and `html` |
| `node` | Off | eslint-plugin-n's recommended rules | `scope`: every code file. `typeStripping: false`: `true` reports what Node's type stripping can't run, and `.js` specifiers of `.ts` files |
| `html` | Off | html-eslint's recommended rules for `.html` files, without layout ones | `rules` |
| `turbo` | Off | Environment variables missing from `turbo.json` | `rules` |
| `vitest` | Off | Vitest's rules and globals | `files`: `testFiles`, without Playwright's files |
| `playwright` | Off | eslint-plugin-playwright's recommended rules | `files`: the code files in `e2e` and `playwright` folders, and `*.e2e.*` files |
| `storybook` | Off | eslint-plugin-storybook's recommended rules, for Storybook 9 or later | `files`: `*.stories.*` files and the code files in `.storybook` folders |
| `antislop` | Off | eslint-plugin-slop's rules and sonarjs's rules for redundant, duplicated and dead code | `slop: true`, `sonarjs: true`. `cognitiveComplexity: 25`: the limit of `sonarjs/cognitive-complexity`, or `false` for none |
| `browser`, `server` | Off | Browser globals and reports of Node's, or reports of browser globals | `files`: required |
| `commonjs` | Off | Lints `.js` files as CommonJS | `files`: every `.js` file |

`react.compiler` is on when `root`'s `package.json`, or a workspace package's, lists `babel-plugin-react-compiler` or `react-compiler-runtime` in `dependencies` or `devDependencies`. Set it to `true` or `false` to override the detection. The other React Hooks rules always run. `react-refresh/only-export-components` allows React Router's route-module exports, such as `loader` and `meta`, in every React file, and Next.js's page exports in `nextjs`'s files.

## Common tasks

### Change or turn off a rule

```js
import { defineConfig } from '@gpahal/eslint-config'

export default defineConfig({
  root: import.meta.dirname,
  javascript: { rules: { 'no-console': ['error', { allow: ['info', 'warn', 'error'] }] } },
  typescript: { rules: { '@typescript-eslint/no-explicit-any': 'off' } },
})
```

An area's `rules` take only that area's rules, such as `unicorn/*` for `unicorn.rules`, and an unknown rule throws. They come before the exemptions, the configs that turn rules off for kinds of files, such as non-null assertions in tests, so they don't turn an exempted rule back on. Use `configs` for that, as [Config order][] explains.

### Turn a rule off for tests

```js
import { defineConfig, files } from '@gpahal/eslint-config'

export default defineConfig({
  root: import.meta.dirname,
  configs: [{ files: [...files.test], rules: { 'sonarjs/no-hardcoded-passwords': 'off' } }],
})
```

`configs` come after the presets and the exemptions, so they win. `files` holds the default globs of each kind of file; `files.test` is the default `testFiles`. [Where your configs apply][] explains which files each rule of your config reaches.

### Add ignores and test files

```js
import { defineConfig } from '@gpahal/eslint-config'

export default defineConfig({
  root: import.meta.dirname,
  ignores: (defaults) => [...defaults, 'fixtures/**'],
  testFiles: (defaults) => [...defaults, 'e2e/**/*.ts'],
})
```

`ignores` and `testFiles` take a function, which gets a copy of the defaults, or an array, which replaces them. A `!` glob un-ignores in `ignores`, as in `'!**/dist'`, and leaves out files in `testFiles`. Unlike antfu's config, `ignores: ['dist']` replaces the defaults, so ESLint lints lockfiles and build output again; pass a function to add to them.

### Limit a preset to part of a monorepo

```js
import { defineConfig } from '@gpahal/eslint-config'

export default defineConfig({
  root: import.meta.dirname,
  react: { scope: ['apps/web/**'] },
  nextjs: { rootDir: ['apps/web'] },
  node: { scope: ['apps/api/**', 'scripts/**'] },
})
```

`scope` limits `react`, `nextjs`, `node` and `tailwindcss` to matching files. A `!` glob excludes files, as in `['apps/web/**', '!apps/web/vendor/**']`. [Preset scopes][] explains how `react` and `nextjs` share their scopes.

### Set up a monorepo

```js
// eslint.config.mjs in the monorepo's root
import { defineConfig } from '@gpahal/eslint-config'

export default defineConfig({
  root: import.meta.dirname,
  react: { scope: ['apps/web/**'] },
  configs: [{ files: ['packages/cli/**'], rules: { 'no-console': 'off' } }],
})
```

Use one config at the workspace root. typescript-eslint keeps one project service per process, so configs per package conflict in one ESLint run or editor server when their config files, compiler options or type packages differ, as [Typed config files][] explains. Limit presets to packages with `scope`, and set package rules with `configs` and `files`.

With a config per package, `import-x/no-extraneous-dependencies` reads each package's own `package.json`, so list the tools that a package's configs and tests import, such as `vitest`, in its `devDependencies`.

### Separate browser and server code

```js
import { defineConfig } from '@gpahal/eslint-config'

export default defineConfig({
  root: import.meta.dirname,
  browser: { files: ['src/client/**'] },
  server: { files: ['src/app/api/**', 'src/server/**'] },
})
```

`browser` gives its files browser globals, such as `document`, and reports Node's globals and built-in modules in them. Without `browser`, `react`, `nextjs` or `astro`, code files have only Node's globals. `server` reports browser globals, including `localStorage`, `sessionStorage` and `Storage`, which Node defines only behind a flag, and wins for a file both match. [Browser and server code][] covers `typeof` checks, browser ports of built-ins and `process.env`.

### Override with the composer

```js
import { defineConfig } from '@gpahal/eslint-config'

export default defineConfig({ root: import.meta.dirname })
  .overrideRules({ '@typescript-eslint/no-unused-vars': 'warn' })
  .override('gpahal/javascript/rules', { ignores: ['vendor/**'] })
  .remove('gpahal/fixes/report-only')
  .append({ files: ['scripts/**'], rules: { 'no-console': 'error' } })
```

Methods queue changes in call order, and ESLint applies them when it awaits the composer. Overrides through `configs` or composer methods get validation and keep the final guards, such as the config that turns formatting rules off. [Composer methods][] lists the methods.

### Register a plugin of your own

```ts
import somePlugin from 'eslint-plugin-some'

import { defineConfig, untyped } from '@gpahal/eslint-config'

export default defineConfig({
  root: import.meta.dirname,
  configs: [
    { plugins: { some: somePlugin }, rules: { 'some/rule': 'error' } },
    untyped({ rules: { 'unicorn/newer-rule': 'error' } }),
  ],
})
```

A config that registers `plugins` takes any rule name, and `untyped` lets a config name a rule newer than the generated types, such as `unicorn/newer-rule` here. The rule must exist in the loaded plugin. A plugin's preset that turns on formatting rules throws with every such rule in one error; pass it through `withoutFormattingRules`, which returns copies without the formatting rules that `allowFormattingRules` describes, as in `configs: withoutFormattingRules(somePlugin.configs.recommended)`.

### Speed up startup

```js
import { defineConfig } from '@gpahal/eslint-config'

export default defineConfig({
  root: import.meta.dirname,
  typeAware: { allowDefaultProject: ['packages/*/vitest.config.ts'] },
  sonarjs: false,
})
```

An explicit `typeAware.allowDefaultProject` array skips parsing the tsconfigs, and replaces the detected list, so list every such file. `sonarjs: false` skips loading eslint-plugin-sonarjs, at the cost of its bug rules. The folder walk still runs, for `gitignore` and `imports`. [Startup cost][] has the measurements.

### Lint some files without type information

```js
// eslint.config.mjs
import { defineConfig } from '@gpahal/eslint-config'

export default defineConfig({
  root: import.meta.dirname,
  typeAware: { ignores: ['src/generated/**', 'legacy/**'] },
})
```

`typeAware.ignores` lists code files to lint without type information, as JavaScript files are, such as generated code or a folder that no tsconfig includes. The type-aware rules are off in them, and the core rules that typed rules replace, such as `no-implied-eval`, run instead. The project service never opens them, so they get no `was not found by the project service` error and don't count toward the [default project's limit][Typed config files]. A `!` glob leaves out files, as in `['src/generated/**', '!src/generated/typed/**']`.

### Give config files Node types

```jsonc
// tsconfig.json in root
{ "compilerOptions": { "types": ["node"] }, "include": ["src"] }
```

Config files that no tsconfig includes get type information from a default project with the compiler options of `root`'s `tsconfig.json`. List `node` in its `types` and install `@types/node`; otherwise `defineConfig` warns, and type-checked rules report on the config files. A `types` list replaces the inherited one, so keep inherited entries, as in `"types": ["vite/client", "node"]`. A solution-style `tsconfig.json` with `"files": []` and `references`, as in Vite's templates, needs the same `compilerOptions`.

### Lint a JavaScript project

```js
// eslint.config.mjs
import { defineConfig } from '@gpahal/eslint-config'

export default defineConfig({ root: import.meta.dirname, typeAware: { javascript: true } })
```

```json
// jsconfig.json
{
  "compilerOptions": { "jsx": "react-jsx", "types": ["node"] },
  "include": ["src", "*.config.mjs"]
}
```

Without `typeAware.javascript`, JavaScript files are linted without type information, and a project without TypeScript files or a `tsconfig.json` or `jsconfig.json` at `root` needs only `defineConfig({ root: import.meta.dirname })`. With it, the type-checked rules run on JavaScript files, which must be in a jsconfig or tsconfig. The default project reads only `root`'s `tsconfig.json`, so the jsconfig includes the config files. For `.jsx` files, install `@types/react`, or the `no-unsafe-*` rules report their JSX.

A project with no TypeScript file outside the ignores and dot folders is linted without loading typescript-eslint. JavaScript files get ESLint's parser and the core twins of typescript-eslint's rules, such as `no-unused-vars`. `astro`, `typeAware.allowDefaultProject`, `typescript.rulesTypeAware`, a `typescript.rules` entry or a config in `configs` that names typescript-eslint loads it. A composer method can't load it, so name typescript-eslint rules in `configs`.

### Lint a CommonJS package

With `"type": "commonjs"` in `package.json`, as `npm init -y` writes it, Node runs `.js` files as CommonJS, while the configs lint them as ES modules. `commonjs: true` lints them as `.cjs` files: as scripts with Node's CommonJS globals, `require()` allowed and ESM syntax reported by `@gpahal/no-esm-in-commonjs`. With `node`, they get eslint-plugin-n's script config. Without a `commonjs` option, such a package with `.js` or `.jsx` files gets a `GPAHAL_COMMONJS_PACKAGE` warning.

<!-- eslint-skip -->

```js
// eslint.config.js
const { defineConfig } = require('@gpahal/eslint-config')

module.exports = defineConfig({ root: __dirname, commonjs: true })
```

`commonjs: { files: ['scripts/**'] }` makes only those `.js` files CommonJS. Other files a glob matches, such as `scripts/a.ts`, stay ES modules, and a glob that can't match a `.js` file throws.

### Find the config of a file

```sh
npx eslint --print-config README.md/0_0.ts
```

`--print-config` prints the merged config of one path, here the first code block of a Markdown file, which ESLint lints as a virtual file. Compare the `rules` of two paths to see what an exemption or your config changes. `npx @eslint/config-inspector` shows every config by name, with the files it matches and the rules it sets.

### Adopt in an existing codebase

```js
// eslint.config.mjs
import { defineConfig } from '@gpahal/eslint-config'

export default defineConfig({
  root: import.meta.dirname,
  typescript: {
    rules: {
      '@typescript-eslint/array-type': 'off',
      '@typescript-eslint/consistent-type-definitions': 'off',
      '@typescript-eslint/method-signature-style': 'off',
    },
  },
  unicorn: { rules: { 'unicorn/filename-case': 'off' } },
  commentLayout: false,
})
```

These five conventions often report on existing TypeScript code and find no bugs. Turn them off in a codebase with other conventions, and keep them for a new project. Most of their reports have fixes, so to adopt one later, turn it on and run `eslint --fix`. For the other rules' reports, see the root README's [Adopt in an existing codebase](https://github.com/gpahal/jslib#adopt-in-an-existing-codebase).

## Recipes

Each recipe adds ESLint to a project that a framework's starter created. The root README's [setup recipes](https://github.com/gpahal/jslib#setup-recipes) add Prettier, Stylelint and the scripts that run the fixers in order.

### Next.js

For an app from create-next-app, without its ESLint setup:

```sh
pnpm add -D @gpahal/eslint-config @gpahal/tsconfig eslint typescript@~6.0.3 @types/node@24 @eslint-react/eslint-plugin \
  eslint-plugin-react-hooks eslint-plugin-jsx-a11y-x eslint-plugin-react-refresh @next/eslint-plugin-next
```

```js
// eslint.config.mjs
import { defineConfig } from '@gpahal/eslint-config'

export default defineConfig({ root: import.meta.dirname, nextjs: true })
```

```json
// tsconfig.json
{
  "extends": "@gpahal/tsconfig/nextjs-app",
  "compilerOptions": { "paths": { "@/*": ["./*"] } }
}
```

```json
// package.json
{
  "type": "module",
  "scripts": {
    "fix:eslint": "next typegen && eslint --fix .",
    "check:eslint": "next typegen && eslint --max-warnings 0 .",
    "check:types": "next typegen && tsc --noEmit"
  }
}
```

`next typegen` writes the route types, such as `PageProps<'/blog/[slug]'>`, into `.next/types`, which a fresh checkout lacks; without them, the type-aware rules report every use as an error type. `@gpahal/tsconfig/nextjs-app` lists `node` in `types`; with a tsconfig of your own, set `"types": ["node"]`.

create-next-app sets up Tailwind CSS by default. Then also install `eslint-plugin-better-tailwindcss`, pass `tailwindcss: { entryPoint: 'app/globals.css' }`, and use the Tailwind options of the Prettier and Stylelint configs, as the root README's setup recipes do. The template's own code then gets reports too:

- The starter's classes get `better-tailwindcss/enforce-canonical-classes` and `better-tailwindcss/no-deprecated-classes` reports, such as `rounded` for `rounded-sm`. Both rules are report-only, so write the classes they suggest.
- Stylelint reports `--font-geist-sans` and `--font-geist-mono` in `app/globals.css` with `no-unknown-custom-properties`, since `next/font` sets them at runtime. Declare them in a stub that nothing imports, and pass `referenceFiles: ['app/fonts.css']` to the Stylelint config, as its [custom property reports](https://github.com/gpahal/jslib/tree/main/packages/stylelint-config#fix-unknown-custom-property-reports) section shows:

```css
/* app/fonts.css */
:root {
  --font-geist-sans: initial;
  --font-geist-mono: initial;
}
```

### Vite with React, Vitest and Tailwind CSS

For an app from create-vite's `react-ts` template, with Tailwind CSS through `@tailwindcss/vite` and `@import 'tailwindcss'` in `src/index.css`:

```sh
pnpm add -D @gpahal/eslint-config eslint typescript@~6.0.3 @types/node@24 @eslint-react/eslint-plugin eslint-plugin-react-hooks \
  eslint-plugin-jsx-a11y-x eslint-plugin-react-refresh vitest @vitest/eslint-plugin tailwindcss @tailwindcss/vite \
  eslint-plugin-better-tailwindcss
```

```js
// eslint.config.mjs
import { defineConfig } from '@gpahal/eslint-config'

export default defineConfig({
  root: import.meta.dirname,
  react: true,
  vitest: true,
  tailwindcss: { entryPoint: 'src/index.css' },
})
```

```json
// tsconfig.json
{
  "files": [],
  "references": [{ "path": "./tsconfig.app.json" }, { "path": "./tsconfig.node.json" }],
  "compilerOptions": { "types": ["node"] }
}
```

The template's `tsconfig.json` is a solution that references the app's and the config files' projects. `eslint.config.mjs` is in neither, so it gets the default project, with the compiler options of `tsconfig.json`. The template's own code gets reports too:

- `App.tsx` gets `unicorn/filename-case`, since component files are kebab-case too: rename it `app.tsx`, or set the rule's options in `unicorn.rules`.
- `App.tsx` gets `better-tailwindcss/no-unknown-classes` for the classes that `App.css` defines, and `@eslint-react/dom-no-unsafe-target-blank` for its `target="_blank"` links without `rel`.
- `main.tsx` gets `no-non-null-assertion` and `unicorn/prefer-query-selector`.

### A static site

For HTML files with scripts in a `js` folder, and no TypeScript:

```sh
pnpm add -D @gpahal/eslint-config eslint typescript@~6.0.3 @html-eslint/parser @html-eslint/eslint-plugin
```

```json
// package.json
{ "private": true, "type": "module" }
```

```js
// eslint.config.mjs
import { defineConfig } from '@gpahal/eslint-config'

export default defineConfig({
  root: import.meta.dirname,
  html: true,
  browser: { files: ['js/**'] },
})
```

`"type": "module"` lints the scripts as ES modules, and `"private": true` keeps the rules for published packages off. `browser` gives the scripts browser globals; without it, they get `no-undef` on every one. A project without a `tsconfig.json` and TypeScript files needs no tsconfig.

### Storybook and Playwright

For the Vite app above, with Storybook 9 or later and the Playwright tests that create-playwright writes to `tests`:

```sh
pnpm add -D eslint-plugin-storybook eslint-plugin-playwright
```

```js
// eslint.config.mjs
import { defineConfig } from '@gpahal/eslint-config'

export default defineConfig({
  root: import.meta.dirname,
  react: true,
  vitest: true,
  tailwindcss: { entryPoint: 'src/index.css' },
  storybook: true,
  playwright: { files: ['tests/**'] },
})
```

Add the new files to the template's projects: `"include": ["src", ".storybook"]` in `tsconfig.app.json`, and `"include": ["vite.config.ts", "vitest.shims.d.ts", "playwright.config.ts", "tests"]` in `tsconfig.node.json`. TypeScript's `**` skips dot folders, so the tsconfig names `.storybook`.

The default `playwright.files` are the code files in `e2e` and `playwright` folders, so create-playwright's `testDir: './tests'` needs `files: ['tests/**']`, or `GPAHAL_PLAYWRIGHT_FILES_UNMATCHED` warns. Vitest's rules leave out Playwright's files. create-playwright's `playwright.config.ts` gets `strict-boolean-expressions` on `process.env.CI`: compare with `undefined`, as in `retries: process.env.CI === undefined ? 0 : 2`.

## Migrating

### From @antfu/eslint-config

- Rules keep their plugins' own names, and there's no `renamePlugins`: `ts/` rules are `@typescript-eslint/`, `node/` rules `n/`, `test/` rules `vitest/`, `yaml/` rules `yml/`, and imports use `import-x/`. Rename them in your configs and disable comments.
- Prettier formats, so there are no stylistic rules. A config that turns on a formatting rule throws unless `allowFormattingRules` lists it.
- A preset's `overrides` are its area's `rules`, as in `typescript: { rules: { … } }`. Rules for other files go in `configs`, with `files`.
- `ignores: [...]` replaces the default ignores; pass a function, as in `ignores: (defaults) => [...defaults, 'dist']`.
- `root` is required, and presets are off until you set them. `defineConfig` warns of a framework in `package.json` whose option isn't set.
- antfu's `lessOpinionated` has no option here; [Adopt in an existing codebase](#adopt-in-an-existing-codebase) turns off the noisiest conventions.

### From eslint-config-next or `next lint`

Next.js 16 removed `next lint`. Uninstall eslint-config-next, delete the config that extends it, and use `nextjs: true`. Run `next typegen && eslint .` in place of `next lint`, so the route types exist before the type-aware rules read them. Set `nextjs.rootDir` when the app isn't at `root`. [Next.js](#nextjs) has the full setup.

### From typescript-eslint and eslint-config-prettier

Replace `tseslint.config(...)`, `parserOptions.projectService` and `tsconfigRootDir` with `defineConfig({ root: import.meta.dirname })`. Drop eslint-config-prettier: the presets leave out the rules it turns off. Move your rules into the areas' `rules` or into `configs` with `files`, and your `languageOptions.globals` into `browser`, `server` or `configs`.

## Troubleshooting

`defineConfig` prints each setup warning once per process, with a code. Fix the cause, or silence the code with the `warnings` option, as in `warnings: { GPAHAL_COMMONJS_PACKAGE: false }`.

### Warnings

| Code | Cause | Fix |
| --- | --- | --- |
| `GPAHAL_FRAMEWORK_OPTION_UNSET` | A `package.json` lists a framework or tool, such as `next` or `vitest`, whose option isn't set | Set the option, and install its plugins, or set it to `false` |
| `GPAHAL_COMMONJS_PACKAGE` | `root`'s `package.json` has `"type": "commonjs"` or no `"type"`, so Node runs `.js` files as CommonJS | Set `"type": "module"`, `commonjs: true`, or `commonjs: false` |
| `GPAHAL_NO_TSCONFIG` | No `tsconfig.json` at or under `root`, so the project service reports each TypeScript file as not found, and config files get no Node types | Add a `tsconfig.json` at `root` with `"types": ["node"]`, or set `typeAware: false` |
| `GPAHAL_FILES_OUTSIDE_TSCONFIG` | TypeScript files, such as `scripts/*.ts`, that no tsconfig includes and the default project doesn't take, so the project service reports each as not found. It names up to 10 | Add them to a tsconfig's `include`, or to `typeAware.allowDefaultProject` |
| `GPAHAL_DEFAULT_PROJECT_NODE_TYPES` | Files in the default project lack Node's types: `root`'s `tsconfig.json` is missing, fails to parse, includes no files or doesn't list `node` in `types`, or `@types/node` isn't installed | The fix the warning names, usually `"types": ["node"]`, keeping inherited entries, and `@types/node` |
| `GPAHAL_LARGE_DEFAULT_PROJECT` | More than 16 files in the default project, each about 8 times slower to type than a file in a tsconfig | Include them in a tsconfig, list only some in `typeAware.allowDefaultProject`, or ignore folders such as fixtures |
| `GPAHAL_ASTRO_TYPES_MISSING` | `tsconfig.json`, or a tsconfig it extends, includes `.astro/types.d.ts`, which doesn't exist, as in a fresh checkout | Run `astro sync` before ESLint, as in `astro sync && eslint .` |
| `GPAHAL_ASTRO_JSX_A11Y_MISSING` | eslint-plugin-jsx-a11y-x isn't installed where ESLint runs, so the `astro/jsx-a11y/*` rules are off | Install it there, at the root of a monorepo |
| `GPAHAL_PLAYWRIGHT_FILES_UNMATCHED` | `playwright.config.*` sets a `testDir` whose tests `playwright.files` doesn't match | Set `playwright: { files: ['tests/**'] }`, the glob the warning names |
| `GPAHAL_GITIGNORE_WILDCARDS` | A `.gitignore` rule has more than 3 `*` in one path segment, which ESLint can take seconds per path to match, so it's skipped | Rewrite the rule with at most 3 |
| `GPAHAL_ROOT_GITIGNORED` | A `.gitignore` or `info/exclude` rule ignores `root` or a folder above it, so git ignores every file. The warning says whether ESLint, which gets the rule rebased onto `root`, does too | Un-ignore the folder with a `!` rule, or set `gitignore: false` |
| `GPAHAL_PEER_NEWER_THAN_RANGE` | ESLint or a preset's plugin is newer than the tested range, so its rules may break | Install a version in the range if they do |
| `GPAHAL_SONARJS_TYPESCRIPT_COPY` | eslint-plugin-sonarjs loads another TypeScript copy than typescript-eslint, so its type-aware rules can misreport | Run `pnpm dedupe` or `npm dedupe`. With pnpm and `typescript` installed as an alias, add the override that the warning names to `overrides` in `pnpm-workspace.yaml` |

### Errors

- **`peer dependencies: needs eslint ^10.11, but 10.0.0 is installed`**, or `typescript ~6.0.3`: run the install command the error names. TypeScript 7 is not supported right now.
- **`<file> was not found by the project service`**: a TypeScript file that no tsconfig includes, which `GPAHAL_FILES_OUTSIDE_TSCONFIG` names. Add it to a tsconfig's `include` or to `typeAware.allowDefaultProject`. A file in a dot folder, such as `.storybook/main.ts`, needs the folder named in `include`.
- **`Too many files (>N) have matched the default project`**: more files matched `typeAware.allowDefaultProject` than the limit `defineConfig` set, which typescript-eslint keeps for the process. A function's globs count only files outside dot folders, so list a dot-folder glob in an array. In an editor, run **ESLint: Restart ESLint Server** after adding config files.
- **`Unsafe assignment of an error typed value`** in a config file: the default project lacks Node's types or the package's types. Follow the `GPAHAL_DEFAULT_PROJECT_NODE_TYPES` warning.
- **`` `<file>` is in the default project, and a tsconfig project also includes it through an import ``**: add the file to that tsconfig's `include`, or filter it out of `typeAware.allowDefaultProject` with the function the error shows.
- **`the config of <root> changed in this process`**, after `project service`: an editor's ESLint server reloaded an edited config, and typescript-eslint keeps the first project service. Restart the server, or run ESLint again.
- **`the config of <root> sets … in the config of <other root>, whose project service this process already uses`**: one run loads configs of several packages whose project services differ. Use one config at the workspace root, as [Set up a monorepo][] explains.
- **`ESLint reaches <file> through <path>, another path to <root>`**: ESLint runs through a symbolic link or another case of `root`'s path. Lint through `root`, as in `eslint src`, pass the real path, `import.meta.dirname`, as `root`, and in an editor open the folder at the path `root` names.
- **`Unexpected undescribed directive comment`** at column 0: `require-description` reports a directive without a reason at column 0 on purpose, so no directive on that line can hide the report. Add the reason, as in `// eslint-disable-next-line no-console -- CLI output`.
- **`is a rule that eslint-config-prettier turns off`** or **`is a layout rule for files that Prettier formats`**: your config turns on a formatting rule. Turn it off, list it in `allowFormattingRules`, or pass a plugin's preset through `withoutFormattingRules`.
- **`is a rule that needs type information`**, with `typeAware: false`: remove the rule or `typeAware: false`.
- **`needs type information, which <glob> files don't get`**: your config turns on a type-aware rule only for files without type information. Apply the fix the error names, or remove the rule.
- **`Internal error: Atomics.wait() failed: timed-out`**, with a `better-tailwindcss/*` rule: eslint-plugin-better-tailwindcss loads Tailwind CSS in worker threads and gives each call 30 seconds, which a busy machine, such as a CI runner with several ESLint processes, can exceed. Raise it with the `SYNCKIT_TIMEOUT` environment variable, in milliseconds, as in `SYNCKIT_TIMEOUT=300000 eslint .`.
- **`returns a composer, which ESLint reads as a config object`**: await the composer before putting it in an array or `extends`, as in `...(await defineConfig({ … }))`.

The root README covers [editor setup](https://github.com/gpahal/jslib#editor-setup) and the errors of installing and running the tools together.

## Reference

### Setups

| Project | Options | tsconfig | Type information |
| --- | --- | --- | --- |
| JavaScript | `root` | None | None |
| Static site | `html: true` and `browser: { files }` for its scripts | None | None |
| JavaScript checked with `checkJs` | `typeAware: { javascript: true }` | A `jsconfig.json` that lists `node` in `types` and includes the config files | The files it includes |
| TypeScript library | `typescript: { library: true }` | A `tsconfig.json` that lists `node` in `types` when config files import Node modules | Its files, and the config files through the default project |
| Node scripts or app | `node: true`, with `typeStripping: true` when Node runs the `.ts` sources | `@gpahal/tsconfig/node-app` | Its files, and the config files through the default project |
| React with Vite | `react: true` | A solution-style `tsconfig.json` with `"types": ["node"]`, referencing the app's and the root config files' tsconfigs | The referenced projects' files, and the other config files through the default project |
| Astro | `astro: true` | The app in `tsconfig.json`, with `"types": ["node"]`; run `astro sync` before ESLint | `.ts`, `.tsx` and `.astro` files, and the root config files through the default project |
| Next.js | `nextjs: true`, with `rootDir` when the app isn't at `root`; run `next typegen` before ESLint | `@gpahal/tsconfig/nextjs-app`, which lists `node` in `types` | Its files, and the config files that it leaves out through the default project |
| Monorepo, or an editor with several workspace folders | One config at the workspace root, with `scope` for package presets | One per package | Each package's files through its tsconfig; [one project service][Typed config files] serves them all |

### Options

`defineConfig` returns a composer, which ESLint awaits for the configs. Its options, rules and methods are typed, so a misspelled rule or config name fails to type-check and throws when ESLint loads the config. ESLint loads an `eslint.config.ts` with `jiti` installed, or with `eslint --flag unstable_native_nodejs_ts_config`, and `// @ts-check` type-checks a JavaScript config. `EslintConfigOptions` documents every option.

Globs are relative to `root`. An empty glob, a lone `!`, a glob that starts with `/` or `..`, an absolute Windows glob, such as `C:/src/**` or `//server/share/**`, and a glob with a `\` separator throw, in the options and in your configs' `files` and `ignores`. `testFiles`, each `files` option, `typeAware.ignores` and each `scope` take brace globs, such as `src/{client,shared}/**`, and `!` globs, which leave out the files they match. A list of only `!` globs throws, and so does a glob that can't match the files the option is for. Test and story globs apply only to the code files they match.

| Option | Default | What it does |
| --- | --- | --- |
| `root` | Required | The project folder, usually `import.meta.dirname`, the base of every path and glob. It throws when it's relative or isn't an existing folder |
| `typeAware` | `true` | Type information for TypeScript files, `false` to lint without it, or `{ javascript, allowDefaultProject, ignores }`. `allowDefaultProject` defaults to the config files that no tsconfig lists. `ignores` lists code files to lint without type information. With `false`, disable comments for typed rules are reported as unused; remove them, or run ESLint with `--report-unused-disable-directives-severity off` |
| `testFiles` | Test files and folders, and test setup files such as `vitest.setup.ts` and `setupTests.ts` | Test code, with looser rules and dev dependencies allowed |
| `commonjs` | Off | Lints `.js` files as CommonJS, as `.cjs` files are. `true` is every `.js` file, and `{ files }` lists them. `false` turns off the `GPAHAL_COMMONJS_PACKAGE` warning |
| `ignores` | Framework and tool output, such as `dist`, `.next`, `coverage` and `storybook-static`, Vite's and Vitest's `*.timestamp-*` config bundles, Yarn's `.yarn/releases` and `.yarn/plugins`, generated and minified files, and lockfiles | Globs ESLint ignores. `build`, `out` and `target` aren't ignored, since they can name source folders; list them in `.gitignore` |
| `gitignore` | `true` | Ignore what the repository's `info/exclude` and `.gitignore` files ignore, and its submodule folders, but not git's global `core.excludesFile`. `{ files }` adds ignore files |
| `browser`, `server` | Off | `{ files, rules }` for browser or server code, or `false` |
| `configs` | `[]` | Your own configs, after the presets and exemptions |
| `allowFormattingRules` | `[]` | Formatting rules, those eslint-config-prettier turns off and the layout rules of html-eslint and eslint-plugin-astro, such as `@html-eslint/indent` and `astro/semi`, that `configs`, the composer's methods and areas' `rules` may turn on. Listing one that a preset leaves out, such as `unicorn/empty-brace-spaces`, keeps it on |
| `warnings` | `{}` | The [setup warnings](#warnings) to silence, by code, as in `{ GPAHAL_COMMONJS_PACKAGE: false }`. An unknown code or a non-boolean value throws |
| `isInEditor` | Detected | In an editor, `prefer-const` reports without fixing. Detection reads the variables that VS Code, JetBrains IDEs, Vim, Neovim, Zed and Emacs's shells set. For editors it misses, such as Emacs's eglot and lsp-mode, Sublime Text's LSP and Helix, set it from a variable of the editor's ESLint server settings, as in `isInEditor: process.env.ESLINT_IN_EDITOR === '1'` |
| `javascript`, `typescript` | Always on | Core and typescript-eslint rules, `{ rules }`. `typescript` also takes `rulesTypeAware`, `library`, `exhaustiveSwitch` and `strictBooleanExpressions`, as [Presets at a glance](#presets-at-a-glance) describes |
| `imports`, `unicorn`, `regexp`, `sonarjs`, `commentLayout`, `e18e`, `eslintComments`, `jsdoc`, `json`, `yaml`, `toml`, `packageJson`, `markdown` | On | Areas, each `false` or `{ rules }`. `imports.removeUnused` makes `--fix` remove unused imports, keeping a value import's module loaded, as [Report-only fixes][] explains. `imports.cycles` turns on `import-x/no-cycle`; `{ maxDepth }` limits how many imports deep it follows. It's off by default for its cost. `e18e` takes `modernization` and `performanceImprovements`, on by default, and `moduleReplacements`, off since `e18e/ban-dependencies` reports packages such as `axios`. All three `false` throws unless `rules` turns a rule on; use `e18e: false` |
| `pnpm` | On in a pnpm workspace: the nearest `pnpm-workspace.yaml` at or above `root`, up to the git root, is at `root` or its `packages` globs match `root` | `eslint-plugin-pnpm` rules. `true` without `pnpm-workspace.yaml` at or above `root` throws |
| `react`, `nextjs`, `node` | Off | Presets that take `scope`. `react` takes `refresh` and `compiler`, `nextjs` `rootDir`, and `node` `typeStripping` |
| `tailwindcss` | Off | `{ entryPoint, settings, scope, rules }`, or `false`. `entryPoint`, the Tailwind CSS entry stylesheet, is required and must exist, so `true` throws. It takes a path relative to `root`, an absolute path, or a `file:` URL, such as `import.meta.resolve('./src/styles.css')`. `settings` are eslint-plugin-better-tailwindcss's other settings; `settings.entryPoint` throws |
| `astro`, `html`, `turbo` | Off | Presets, `true` or `{ rules }` |
| `vitest` | Off | Vitest rules and globals for `testFiles`, or `{ files }`, but not the files of `playwright` |
| `playwright` | Off | eslint-plugin-playwright's recommended rules for end-to-end tests, or `{ files }`. They get the test exemptions, and not Vitest's rules and globals |
| `storybook` | Off | eslint-plugin-storybook's recommended rules for stories, and `storybook/no-uninstalled-addons` for `.storybook/main.*`, or `{ files }`. In stories, `react-hooks/rules-of-hooks` and `import-x/no-anonymous-default-export` are off, as in Storybook's config. MDX stories aren't linted. On Storybook 8, `storybook/no-renderer-packages` reports every story |
| `antislop` | Off | Rules for code that reads as generated without care, from eslint-plugin-slop and sonarjs, which `slop: false` and `sonarjs: false` turn off. `slop/no-em-dash` skips JSON, YAML and TOML files unless `rules` turns it on. `cognitiveComplexity` sets the limit of `sonarjs/cognitive-complexity` |

`gitignore` walks every folder under `root` that git doesn't ignore each time the config loads, so `.gitignore` edits apply on a reload. The same walk serves `imports` and the default project, so `gitignore: false` alone saves little startup time. As with ESLint's `includeIgnoreFile`, a `.gitignore` rule also ignores files that git tracks. An unreadable ignore file throws; an unreadable folder is skipped. With `core.ignorecase`, as on macOS and Windows, the rules match paths in any case, as git matches them.

Invalid options, globs and user configs throw a `TypeError`. Checks that need plugins, such as missing peers and unknown rules, reject when ESLint awaits the config. The error for missing or outdated peers lists every preset's, with one install command.

`GPAHAL_FRAMEWORK_OPTION_UNSET` reads the `dependencies` and `devDependencies` of `root`'s `package.json` and of workspace packages; a published package, without `"private": true`, counts only its `dependencies` and required peers. Setting the option, even to `false`, turns the warning off.

`packageJson` and the manifest checks of `pnpm` skip `**/fixtures/**` and `**/__fixtures__/**`, and so do the rules their `rules` options turn on.

With `node`, set `engines.node` in `package.json`, or `n/no-unsupported-features/*` assumes Node `>=16.0.0` and reports `fetch` and `import.meta.dirname`. Config files and `scripts` folders outside a package's `src` folder are checked against Node `>=24.22.0`, the Node they run on. A `settings.n.version` in your config overrides both. `n/hashbang` is off in TypeScript files, whose `bin` names the built file, and in `scripts` folders.

`node: { typeStripping: true }` is for an app that Node runs from its `.ts` sources, such as one on `@gpahal/tsconfig/node-app`. It turns on `@gpahal/no-js-specifier-for-ts`, since Node loads the file a `./b.js` specifier names rather than `b.ts`, and `@gpahal/no-unstrippable-syntax`. TypeScript's `erasableSyntaxOnly` reports most of the same syntax; the rule adds decorators, `accessor` fields and named `module` declarations.

`tailwindcss` takes one `entryPoint` and one `settings.cwd`, so every file in its `scope` is checked against one stylesheet and one Tailwind CSS install. In a monorepo whose apps have their own stylesheets, scope it to one app, or run ESLint once per app. `settings.cwd`, where the plugin loads Tailwind CSS from, defaults to `root`, and the configs reject when Tailwind CSS isn't installed there.

ESLint takes one plugin object per name. A config that doesn't come from `defineConfig` registers the preset's wrapped plugins, whose rules report at Markdown's own columns, through these exports:

- With `antislop`, `slop` as `slopPlugin` from `@gpahal/eslint-config/slop`.
- With `eslintComments`, `@eslint-community/eslint-comments` as `eslintCommentsPlugin` from `@gpahal/eslint-config/eslint-comments`.

Your config that registers a plugin under a name a preset uses, such as `package-json`, must pass the same object, or `defineConfig` rejects and names the area option to use instead. For `slop` and `@eslint-community/eslint-comments`, the stock plugin is swapped for the wrapped one.

### Lists and merging

An array replaces a list, and a function transforms a copy of its defaults; `scope` takes only arrays. The root README's [Lists and merging](https://github.com/gpahal/jslib#lists-and-merging) lists each option's defaults and limits.

`ignores: []` drops every default ignore, leaving what ESLint ignores itself, `node_modules` and `.git`, and what `gitignore` reads.

A rule's options never merge with the presets': a later setting replaces them. So your `no-restricted-globals` replaces the confusing browser globals that browser code gets; list the names you want to keep too.

### Config order

The configs are named `gpahal/<area>/<part>`, and a later config wins for a rule that both set. They come in this order:

1. This package's configs: the presets, then the areas' `rules`, then the exemptions, which turn rules off for kinds of files.
2. Your `configs`.
3. The code-block configs, for Markdown code blocks and Astro `<script>` blocks.
4. The configs that the composer's `.append()` adds.

The guards come last, after the configs an `.onResolved()` callback returns too: `gpahal/formatting/off` turns off the formatting rules that `allowFormattingRules` doesn't list, `gpahal/disable-type-checked/…` turns off type-aware rules in files without type information, and `gpahal/root-spelling…` checks the path of each linted file. No composer method or callback sees them, so `.remove()`, `.override()` or `.insertBefore()` with a guard's name throws.

Configs after the composer's, such as a later item in a native config array, `--rule` or an inline `eslint` comment, come after the guards too. The patches that drop a twin rule's report, as [Duplicate rules][] describes, read which rules are on from the composer's configs, so turning a twin off only there, such as `prefer-template` with `--rule`, drops both reports. Turn rules off with an area's `rules` or `configs` instead.

| Files | Exemptions |
| --- | --- |
| Tests, and the files of `playwright` | Non-null and unsafe type assertions, unbound methods, empty functions, `no-promise-executor-return`, `unicorn/consistent-function-scoping` and `unicorn/no-global-object-property-assignment`. `no-unnecessary-condition` doesn't check type predicates. With `vitest`, `vitest/unbound-method` takes over. With `antislop`, `sonarjs/no-identical-functions` is off |
| `.cjs`, `.cts`, and the `.js` files of `commonjs` | `require()` calls; no top-level `await` advice |
| Config files | Anonymous default exports, any file name case, `console`, and `eslint-disable` directives without a reason |
| Scripts and command-line tools | `console` |
| Browser code, and with `react`, `nextjs` or `astro` their files | Iterator helpers, such as `unicorn/prefer-iterator-helpers`, since the browser `lib` lacks ES2025's iterator helpers, and `unicorn/prefer-top-level-await`, since Vite 5 and 6 build for `es2020`. `server` files keep them |
| Code blocks | Rules that don't fit excerpts, such as `@typescript-eslint/no-unused-vars`, `@typescript-eslint/no-unused-expressions`, `import-x/no-unresolved`, every `e18e/*` rule, and `no-labels`, `no-lone-blocks` and `no-unused-labels`, since an object-literal excerpt parses as a labelled block |
| `.astro` files, not their `<script>` blocks | `@typescript-eslint/no-unsafe-*`, `restrict-template-expressions` and `unicorn/prefer-module`, as [Known issues](#known-issues) explains |

### Composer methods

Methods queue changes in call order, and ESLint applies them when it awaits the composer. Invalid configs, unknown names and invalid callback results reject with the call named in the error, as in `` `.override('gpahal/javascript/rules')` ``, and the item for an added config, as in `` `.append()`: item `[0]` ``.

| Method | Effect |
| --- | --- |
| `.override(name, config)` | Merges into matching configs. `rules`, `plugins`, `settings`, `languageOptions` and `linterOptions` merge one level deep, and so do `languageOptions.parserOptions` and `languageOptions.globals`. Other keys, such as `files` and `ignores`, replace theirs. A key set to `undefined` changes nothing |
| `.overrideRules(rules)` | Changes existing enabled rules, preserving exemptions; rejects new enabled rules. A severity alone, such as `'warn'`, keeps the rule's options, and an entry with options replaces them. `null` removes a rule, and `undefined` leaves it, though its name must still be a known rule |
| `.removeRules(...rules)` | Removes the named rules |
| `.disableRulesFix(...rules)` | Makes the named rules report without fixing in every file, in a config named `user/disable-rules-fix` after the configs as they stand. A rule that a later change registers is covered too. Suggestions stay |
| `.remove(...names)` | Removes matching configs. Removing the only config that registers a plugin, such as `gpahal/setup`, rejects while the resolved configs turn on that plugin's rules |
| `.insertBefore(name, ...configs)`, `.insertAfter(name, ...configs)` | Inserts before the first or after the last matching config |
| `.append(...configs)` | Adds configs after the presets |
| `.onResolved(callback)` | Inspects or changes resolved configs |
| `.clone()` | Returns a new composer with a copy of the changes queued so far, so two configs can diverge from a shared base |

The setup warnings about scanned files wait until ESLint awaits the composer, so they leave out files that a global ignores config of `.append()`, `.insertBefore()` or `.insertAfter()` ignores.

Every resolved config gets an absolute `basePath`, `root` by default, which keeps globs rooted when the config file is elsewhere or loaded with `--config`. ESLint rejects a `basePath` inside its native `extends`, so to use `eslint/config`'s `defineConfig`, spread the awaited composer at the top level:

```js
import { defineConfig as eslintDefineConfig } from 'eslint/config'

import { defineConfig } from '@gpahal/eslint-config'

export default eslintDefineConfig(...(await defineConfig({ root: import.meta.dirname })))
```

Inserted configs, and new configs that an `.onResolved()` callback returns, are scoped and checked as `configs` are. Changes to existing configs are checked in their existing scope, so a change that turns a rule on where it can't run, or widens a code config's `files` to non-code files, throws. Invalid arguments, and spreading a composer before awaiting it, throw immediately.

### Where your configs apply

Each rule of your config reaches the files where it can run. A config is one of three kinds, by whether it sets `files` and `language`:

| Your config | Code files | JSON, YAML, TOML, Markdown and HTML files | JavaScript and TypeScript code blocks | Rules that need type information |
| --- | --- | --- | --- | --- |
| Without `files` or `language`, as `{ rules: { 'no-console': 'off' } }` | Every one | None; a rule for them throws | Every one | Code files |
| With `files`, as `{ files: ['src/**'], rules: { 'unicorn/no-null': 'error' } }` | The ones `files` matches | The ones `files` matches, for a rule that runs on them | The ones `files` matches, such as `files.codeBlock` | Code files that `files` matches, as `[['src/**', '**/*.{js,mjs,cjs,jsx,ts,tsx,mts,cts}']]` |
| With `language`, as `{ files: ['**/*.code-workspace'], language: 'json/jsonc', rules: { … } }` | The ones `files` matches, parsed in that language | The ones `files` matches, parsed in that language | The ones `files` matches, parsed in that language | Not limited, as in ESLint |

- A config without `files` or `language` also reaches files that another of your configs gives `files` and a parser, and skips files that one of your configs gives another `language`.
- A rule turned off applies to every file, unless the config has `languageOptions` or `processor`.
- In a config with `files`, a rule skips the files it can't run on. `unicorn/no-null` skips every non-code file, and `unicorn/expiring-todo-comments` runs on JSONC files but not JSON ones. A rule without `meta.languages`, such as a core rule, counts as a JavaScript rule, except eslint-comments' rules, which run in every language.
- A config with `language` runs any rule without `meta.languages`, as ESLint does, and throws on a rule whose `meta.languages` leaves out its language.
- The config's `ignores` and negated globs in `files` entries, such as `[['src/**', '!**/*.json']]`, leave out the files they skip. Patterns whose extension can't be constrained, such as `**/*.t*`, are checked conservatively.

A config whose rules reach different files is split into one config per scope once the plugins load. Each part keeps the config's `name` and comes after one with its `plugins` alone, which registers them for every file, so a directive comment that names a plugin's rule finds it.

Your config without a `name` gets one from its source, such as `user/configs[0]`, `user/configs[1][0]` in a nested array, `user/append[0]` or `user/onResolved[0]`. Each call numbers its configs from 0, so `.override()` and `.remove()` with a name reach every config that has it. `.override()` with a split config's name reaches every part. With `files`, `ignores` or `language`, or with a function, it changes the config before the split and splits the result again.

`defineConfig` throws, naming the fix, on your config that wouldn't do what it says:

- an item that isn't a config or an array of them, `files: []`, or a string in `extends` that doesn't name a config of a plugin the same config registers;
- formatting rules that `allowFormattingRules` doesn't list, all in one error;
- a rule for JSON, YAML, TOML, Markdown or HTML files without `files` or `language`, or with `files` that can match files where it can't run, such as `files: ['**/*.ts']` with `json/no-duplicate-keys`;
- a rule that needs type information with `typeAware: false`, or in a config whose every `files` entry matches only files without it, such as `['**/*.js']` without `typeAware.javascript`;
- `languageOptions.parserOptions.projectService` or `tsconfigRootDir`; use `typeAware.allowDefaultProject`, `typeAware.ignores` or `root`;
- a change to a `gpahal/ignores/*` config that sets a key other than `ignores`, `name` and `basePath`.

Give `package-json/*` rules `files: ['**/package.json']`, not `files.json`, which also matches JSONC files such as `tsconfig.json`.

### Preset scopes

By default, `nextjs` uses `react.scope`, and React uses `nextjs.scope`, so `nextjs: { scope: ['apps/web/**'] }` keeps both presets in the app when `react` is unset or set without `scope`. With both scopes set, React covers `react.scope` and `nextjs`'s files. When `react` is unset, `nextjs` turns React on.

Without `nextjs.scope`, `nextjs.rootDir` sets it: `nextjs: { rootDir: ['apps/web', 'apps/docs'] }` keeps both presets in `apps/web/**` and `apps/docs/**`. `@next/next/no-html-link-for-pages` checks each app's links against its own `pages` folder, and `@gpahal/nextjs-server-component` checks the route entry files in each app's `app` and `src/app` folders.

### Browser and server code

`browser` and `server` allow a global as the operand of `typeof`, as in `typeof window !== 'undefined'`, since `typeof` of an undeclared global doesn't read it. `typeof window.location` reads `window`, so it's reported.

A bare import of a built-in, such as `import 'events'`, passes when `package.json` declares a browser port of it, such as `buffer`, `events`, `path-browserify`, `process`, `url`, `util`, `stream-browserify` or `browserify-zlib`. A port whose name differs from the built-in's also needs a bundler alias.

In `browser` files, `process.env` and its variables, such as `process.env.NODE_ENV`, pass because bundlers replace them, and so do `globalThis.process` and `globalThis.process.env`. Other uses are reported, such as `process.argv` and `const { env } = process`.

### Typed config files

Config files that no tsconfig includes get type information from the default project: a fallback TypeScript program that typescript-eslint builds for the files `typeAware.allowDefaultProject` lists, with the compiler options of `root`'s `tsconfig.json`. TypeScript 6 leaves Node's types out unless `types` lists `node` or `*`, and typescript-eslint silently uses its default options when that tsconfig is missing or has errors, so `defineConfig` warns, as [Warnings](#warnings) describes.

The default project covers `*.config.{ts,mts,cts,js,mjs,cjs}`, including infixes such as `vitest.config.e2e.ts`, dotfile configs such as `.prettierrc.ts`, and Storybook's files in a `.storybook` folder, in folders outside the ignores and dot folders. TypeScript's `**` skips dot folders, so a tsconfig covers `.storybook` only when its `include` names the folder. The files are found when the config loads, so new or renamed ones need an ESLint server restart in editors.

To find these files, `defineConfig` reads the `include`, `files` and `extends` of each tsconfig the project service would open, not imports. A config file that a project includes only through an import, such as `src/x.ts` importing `../site.config.ts`, stays in the default project, and linting it throws. Add it to that tsconfig's `include`, or leave it out with a function, such as `typeAware: { allowDefaultProject: (files) => files.filter((file) => file !== 'site.config.ts') }`. The function gets paths escaped as globs, so a file in a `[slug]` folder arrives as `app/\[slug\]/next.config.ts`. An explicit array skips parsing the tsconfigs and the `GPAHAL_FILES_OUTSIDE_TSCONFIG` check.

`defineConfig` sets the default project's file limit from the files the paths and globs match, with at least 8 files of headroom, and typescript-eslint keeps the first limit for the process. A function's globs count only code files outside dot folders, so for a glob that matches files in a dot folder, use an array that lists every default-project file. typescript-eslint matches `allowDefaultProject` against paths relative to `root` and allows no `**`.

Run ESLint through the same path spelling as `root`. ESLint matches files by the path it was given, while Node resolves symbolic links in `import.meta.dirname`, so on macOS, where `/tmp` links to `/private/tmp`, a `root` under `/tmp` never matches. The `gpahal/root-spelling*` guards throw on a file reached through another path to `root`, naming both paths.

typescript-eslint keeps one project service per process, with the options of the first config that uses it. When one run lints several packages, each with its own `defineConfig`, they share the service only when their config files match the same globs and their tsconfigs have the same compiler options and type packages; otherwise linting throws an error that names both configs. In a monorepo, use [one config at the root][Set up a monorepo].

### Startup cost

A small project took about 0.9 seconds to reach a ready config, and a 100-package workspace about 1.0 seconds, over five fresh processes on macOS ARM64. Plugin loading is much of the cost, so turning off type-aware rules doesn't remove it. An explicit `typeAware.allowDefaultProject` brought the workspace to about 0.95 seconds.

ESLint's `--cache` caches lint results, not config loading; add `.eslintcache` to `.gitignore`. A cached result stays while the file and the config are unchanged, so a type-aware report that depends on another file goes stale. Run without `--cache` in CI.

With type information, each `--concurrency` worker builds its own TypeScript program, so memory grows with the worker count while time drops little. Linting 300 TypeScript files took about 4.9 s and 1.2 GiB in one process, and 4.1 s and 3.0 GiB with `--concurrency=4`, on an Apple M3 Max with Node 24.22. Pick the worker count by the memory you have.

In a full config, `sonarjs: false` saves about 150 ms and 5 MiB of a small TypeScript project's 0.96 s and 368 MiB, at the cost of its bug rules, including `no-hardcoded-secrets` and `no-hardcoded-passwords`. With `antislop`, set `antislop: { sonarjs: false }` too, since its sonarjs rules load the plugin as well.

### What's on by default

- `@eslint/js` recommended and bug-catching core rules, such as `eqeqeq` in `smart` mode and `no-console` with `console.warn` and `console.error` allowed. `guard-for-in`, `grouped-accessor-pairs`, `no-alert`, `no-loop-func`, `no-object-constructor`, `prefer-object-spread` and `no-unneeded-ternary` are on, and typescript-eslint's `default-param-last` replaces the core one.
- typescript-eslint's strict and stylistic type-checked configs, with `no-unnecessary-condition`, `unbound-method`, and `switch-exhaustiveness-check` with `default` cases checked. `no-unreachable` is on in TypeScript files too, since framework templates' tsconfigs don't set `allowUnreachableCode: false`. `require-await` is off, since `promise-function-async` makes every function that returns a promise async. `promise-function-async` leaves alone a function without a return type that returns React's `ReactNode`, as a component that returns `children` does: React awaits the promise in `ReactNode`, and `async` would make every render a promise.
  - `strict-boolean-expressions` reports numbers, nullable strings and nullable numbers in conditions. A nullable boolean passes, as in `{isOpen && <Menu />}`.
  - `no-floating-promises` doesn't take `void` as handling a promise. `node:test`'s `test`, `describe` and hooks, and React Router's `navigate()`, pass as statements.
  - `no-misused-promises` reports a promise returned where `void` is expected, such as an async JSX event handler. To start async work from a synchronous callback, write `run().catch(report)`.
  - `no-unsafe-type-assertion` reports an assertion that narrows, such as `(await res.json()) as User`: parse the value with a schema or check it with a type guard. It's off in test files.
  - `strict-void-return` is off. To turn it on, add it to `typescript.rulesTypeAware` with `'@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }]`, which it covers, and `'no-promise-executor-return': 'off'`.
- eslint-plugin-sonarjs's bug rules and its TLS and crypto rules, such as `unverified-certificate` and `hashing`, the recommended configs of eslint-plugin-unicorn, eslint-plugin-regexp and eslint-plugin-import-x, `@e18e/eslint-plugin`, eslint-comments, which requires a reason after `--` in an `eslint-disable`, and eslint-plugin-jsdoc.
  - `import-x/no-extraneous-dependencies` allows dev dependencies in tests, scripts, stories, benchmarks, declaration files, mocks, `.storybook`, `.vitepress` and config files outside a package's `src` folder. It reads the `package.json` nearest the file.
  - `import-x/no-relative-packages` reports a relative import of another package's file, which skips its `exports`, except in those dev files. `import-x/named` and `import-x/namespace` run only in JavaScript files without type information, since TypeScript checks the others.
- In browser code, `no-restricted-globals` reports the confusing-browser-globals names that read like local variables, such as `top`, `parent` and `length`, and asks for `globalThis.top`, so `unicorn/no-unnecessary-global-this` is off there. In files without type information, it also reports those that `@typescript-eslint/no-deprecated` reports in typed files: `blur`, `event`, `external`, `name`, `onunload` and `status`. `self`, the usual global in workers, is allowed. In the `react` and `nextjs` scopes, config files, CommonJS files and `server` files are left out.
- eslint-plugin-sonarjs's security rules, such as `insecure-jwt-token`, `xml-parser-xxe`, `cookie-no-httponly` and `insecure-cookie`. `pseudo-random`, `no-hardcoded-ip`, `publicly-writable-directories`, `file-permissions`, `no-os-command-from-path` and `sql-queries` stay off, since they report ordinary code such as `Math.random()` and `/tmp`, and so does the deprecated `os-command`. Turn any of them on in `sonarjs.rules`.
- `@gpahal/no-bidi-characters` in every file the config lints, for the bidirectional control characters of Trojan Source.
- Unicorn's recommended rules, without `prefer-await`, `no-break-in-nested-loop`, `no-this-outside-of-class`, `prefer-number-coercion`, `no-computed-property-existence-check` and `prefer-observer-apis`, which report ordinary code, and without `expiring-todo-comments`, whose reports depend on the date, so a clean commit can fail later. `import-style` takes any import style of `node:path` and `node:util`. `prefer-ternary` leaves guard clauses and multi-line branches alone. `prefer-event-target` is off in the `node` preset's files.
- JSON, JSONC and JSON5, YAML, TOML, `package.json`, and Markdown files with their code blocks. TOML files and ` ```toml ` blocks get eslint-plugin-toml's recommended and layout rules, since Prettier doesn't format TOML. `.jsonc` files, ` ```jsonc ` blocks, `tsconfig.json` and VS Code's settings allow trailing commas, and stay JSONC when a config of yours gives them another language, as `{ files: ['**/*.json'], language: 'json/json' }` does, since ESLint rejects trailing commas in it. A `package.json` without `"private": true` must have the metadata a published package needs, such as `exports`, `files`, `license` and `repository`, so an app should set `"private": true`.
- With the presets that are off by default: `html` turns on html-eslint's recommended rules without the layout ones, with `no-target-blank`, `require-button-type` and accessibility rules such as `require-input-label`; inline `<script>` in `.html` files isn't linted.
- `@gpahal/comment-layout` for comments in JS and TS files. `jsdoc/require-returns-description` runs in TypeScript files only, since a JavaScript file's `@returns {T}` may only give `checkJs` its type.
- Import order and `package.json` key order aren't lint rules: `@gpahal/prettier-config` sorts them.
- JavaScript files without type information, the default, don't get the rules that need it, such as `no-floating-promises`, `no-misused-promises`, `await-thenable` and every `no-unsafe-*` rule.
- Conventions: kebab-case file names, `type` over `interface`, `Array<T>`, `import type` for types, and unused names allowed with a `_` prefix or as the siblings of a rest property. `.js` files are linted as ES modules, so name CommonJS files `.cjs`, or set [`commonjs`][Lint a CommonJS package]. In `.ts`, `.mts` and `.tsx` files, `unicorn/prefer-module` reports `__dirname` and `require`, which `@types/node` declares but an ES module lacks.
  - `unicorn/filename-case` also checks the folders between ESLint's working folder and the file; add `checkDirectories: false` to check only file names. It skips files under `__name__` folders and router segments, such as `[postId]`, `(marketing)` and `@modal`, dynamic route files, `vite-env.d.ts`, `next-env.d.ts`, test setup files such as `setupTests.ts`, and text without a file name. Options of yours, such as `{ case: 'camelCase' }`, add to its `ignore` list.
  - `type` over `interface` applies everywhere, `.d.ts` files included. A file-local interface is fixed to a type alias. An interface another file may augment, such as an exported or global one or one in a `.d.ts` file's namespace, whose members are exported without `export`, reports without a fix, and one that already merges with another declaration, such as `ImportMetaEnv` in Vite's `vite-env.d.ts`, or that sits inside `declare global` or an ambient `declare module`, isn't reported. To keep one, add `// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- <why>`.

#### Report-only fixes

`--fix` aims not to change what JavaScript and TypeScript code does at run time, so a rule whose fix can change it only reports, except for the deliberate fixes listed below. The lists come from an audit of the fixer of every rule the presets turn on, and [fix-policy.ts](src/internal/fix-policy.ts) says what each report-only rule's fix would change. This package's tests don't check what each plugin rule's fix does, so a fixer that changes in a plugin's minor release can change what `--fix` does. Commit your lockfile.

By their options, `@typescript-eslint/no-unused-vars` doesn't remove an unused import unless `imports.removeUnused` is on, `vitest/no-focused-tests` doesn't remove `.only`, and `pnpm/json-valid-catalog` doesn't point a specifier at another catalog. In an editor, `prefer-const` only reports too. Remove `gpahal/fixes/report-only`, `gpahal/fixes/report-only-untyped`, `gpahal/fixes/report-only-code-blocks` or `gpahal/fixes/report-only-library` to turn the fixes of its rules back on. `gpahal/fixes/report-only-library` follows the files of `gpahal/typescript/library`, so override that config to change them.

These fixes change code on purpose and keep fixing:

- Repairs of Markdown and HTML markup, such as `@gpahal/markdown/no-missing-atx-heading-space` and `@html-eslint/require-doctype`, which change how the document renders.
- `@typescript-eslint/no-import-type-side-effects` and `@gpahal/no-inline-type-only-export`, which drop the load of a module whose imports are all types. Add `import './a'` for a module that must run.
- Fixes that only break type-checking, such as `unicorn/prefer-at` without `noUncheckedIndexedAccess`, which `tsc` reports. With `typescript.library`, `@typescript-eslint/method-signature-style` only reports in the library's files, since its fix breaks only consumers' `tsc`.
- `regexp/no-missing-g-flag`, which adds the `g` flag that `replaceAll` and `matchAll` need.
- `vitest/valid-expect`, `playwright/missing-playwright-await` and `storybook/await-interactions`, which add the `await` that an asynchronous assertion or interaction needs.
- `jsdoc/no-defaults`, which changes only the docs.
- With `imports: { removeUnused: true }`, outside an editor, `@typescript-eslint/no-unused-vars`, or core `no-unused-vars` where it's on instead, which remove unused import specifiers. An import with none left becomes a side-effect import, as in `import './a'`, and a type-only import goes. An unused namespace import beside a default import only reports.

These rules only report, everywhere:

<details>
<summary>Report-only rules</summary>

`@eslint-react/dom-no-hydrate`, `@eslint-react/dom-no-render`, `@eslint-react/dom-no-use-form-state`, `@eslint-react/no-component-will-mount`, `@eslint-react/no-component-will-receive-props`, `@eslint-react/no-component-will-update`, `@eslint-react/rsc-function-definition`, `@html-eslint/no-redundant-role`, `@html-eslint/require-button-type`, `@typescript-eslint/consistent-indexed-object-style`, `@typescript-eslint/no-array-constructor`, `@typescript-eslint/no-confusing-void-expression`, `@typescript-eslint/no-meaningless-void-operator`, `@typescript-eslint/prefer-function-type`, `@typescript-eslint/prefer-includes`, `@typescript-eslint/prefer-optional-chain`, `@typescript-eslint/prefer-string-starts-ends-with`, `@typescript-eslint/promise-function-async`, `@typescript-eslint/return-await`, `astro/no-deprecated-astro-fetchcontent`, `better-tailwindcss/enforce-canonical-classes`, `better-tailwindcss/enforce-consistent-class-order`, `better-tailwindcss/enforce-consistent-line-wrapping`, `better-tailwindcss/no-deprecated-classes`, `better-tailwindcss/no-duplicate-classes`, `better-tailwindcss/no-unnecessary-whitespace`, `e18e/prefer-array-from-map`, `e18e/prefer-array-some`, `e18e/prefer-date-now`, `e18e/prefer-includes`, `e18e/prefer-object-has-own`, `e18e/prefer-regex-test`, `e18e/prefer-spread-syntax`, `e18e/prefer-timer-args`, `import-x/first`, `import-x/no-absolute-path`, `import-x/no-relative-packages`, `jsdoc/check-tag-names`, `jsdoc/empty-tags`, `jsdoc/no-multi-asterisks`, `json/no-unnormalized-keys`, `markdown-preferences/definitions-last`, `markdown-preferences/emoji-notation`, `markdown-preferences/hard-linebreak-style`, `markdown-preferences/level1-heading-style`, `markdown-preferences/level2-heading-style`, `markdown-preferences/ordered-list-marker-sequence`, `markdown-preferences/ordered-list-marker-start`, `markdown-preferences/prefer-fenced-code-blocks`, `markdown-preferences/prefer-link-reference-definitions`, `markdown-preferences/sort-definitions`, `markdown/no-reference-like-urls`, `markdown/no-space-in-emphasis`, `n/hashbang`, `no-extra-bind`, `object-shorthand`, `package-json/repository-shorthand`, `package-json/require-type`, `package-json/valid-author`, `playwright/no-unsafe-references`, `playwright/no-useless-await`, `playwright/prefer-to-have-count`, `playwright/prefer-to-have-length`, `playwright/prefer-web-first-assertions`, `playwright/valid-title`, `prefer-object-spread`, `prefer-template`, `regexp/control-character-escape`, `regexp/no-dupe-characters-character-class`, `regexp/no-trivially-nested-quantifier`, `regexp/no-useless-character-class`, `regexp/no-useless-flag`, `regexp/no-useless-lazy`, `regexp/no-useless-non-capturing-group`, `regexp/no-useless-set-operand`, `regexp/no-useless-string-literal`, `regexp/optimal-quantifier-concatenation`, `regexp/prefer-character-class`, `regexp/prefer-predefined-assertion`, `regexp/prefer-question-quantifier`, `regexp/prefer-set-operation`, `regexp/prefer-unicode-codepoint-escapes`, `regexp/prefer-w`, `regexp/strict`, `regexp/use-ignore-case`, `storybook/default-exports`, `storybook/hierarchy-separator`, `storybook/use-storybook-testing-library`, `unicorn/consistent-boolean-name`, `unicorn/dom-node-dataset`, `unicorn/escape-case`, `unicorn/explicit-length-check`, `unicorn/name-replacements`, `unicorn/new-for-builtins`, `unicorn/no-array-reduce`, `unicorn/no-console-spaces`, `unicorn/no-declarations-before-early-exit`, `unicorn/no-for-each`, `unicorn/no-for-loop`, `unicorn/no-immediate-mutation`, `unicorn/no-incorrect-query-selector`, `unicorn/no-instanceof-builtins`, `unicorn/no-invalid-url-protocol-comparison`, `unicorn/no-invalid-well-known-symbol-methods`, `unicorn/no-named-default`, `unicorn/no-new-array`, `unicorn/no-redundant-comparison`, `unicorn/no-selector-as-dom-name`, `unicorn/no-single-promise-in-promise-methods`, `unicorn/no-static-only-class`, `unicorn/no-unnecessary-await`, `unicorn/no-unnecessary-global-this`, `unicorn/no-unnecessary-splice`, `unicorn/no-useless-else`, `unicorn/no-useless-iterator-to-array`, `unicorn/no-useless-override`, `unicorn/no-useless-promise-resolve-reject`, `unicorn/no-useless-spread`, `unicorn/no-useless-undefined`, `unicorn/prefer-add-event-listener`, `unicorn/prefer-aggregate-error`, `unicorn/prefer-array-find`, `unicorn/prefer-array-flat`, `unicorn/prefer-array-flat-map`, `unicorn/prefer-array-from-range`, `unicorn/prefer-array-index-of`, `unicorn/prefer-array-some`, `unicorn/prefer-block-statement-over-iife`, `unicorn/prefer-classlist-toggle`, `unicorn/prefer-dom-node-html-methods`, `unicorn/prefer-dom-node-replace-children`, `unicorn/prefer-export-from`, `unicorn/prefer-get-or-insert-computed`, `unicorn/prefer-global-this`, `unicorn/prefer-group-by`, `unicorn/prefer-https`, `unicorn/prefer-includes`, `unicorn/prefer-keyboard-event-key`, `unicorn/prefer-location-assign`, `unicorn/prefer-math-min-max`, `unicorn/prefer-modern-math-apis`, `unicorn/prefer-native-coercion-functions`, `unicorn/prefer-negative-index`, `unicorn/prefer-object-define-properties`, `unicorn/prefer-object-from-entries`, `unicorn/prefer-object-iterable-methods`, `unicorn/prefer-private-class-fields`, `unicorn/prefer-promise-static-methods`, `unicorn/prefer-query-selector`, `unicorn/prefer-queue-microtask`, `unicorn/prefer-response-static-json`, `unicorn/prefer-set-has`, `unicorn/prefer-single-call`, `unicorn/prefer-spread`, `unicorn/prefer-string-pad-start-end`, `unicorn/prefer-type-error`, `unicorn/require-css-escape`, `unicorn/require-number-to-fixed-digits-argument`, `vitest/consistent-test-it`, `vitest/no-import-node-test`, `vitest/no-unneeded-async-expect-function`, `vitest/prefer-called-exactly-once-with`, `vitest/prefer-to-be`, `vitest/valid-title`.

</details>

In Markdown code blocks, `@typescript-eslint/array-type`, `@typescript-eslint/consistent-type-definitions`, `@typescript-eslint/method-signature-style` and `@typescript-eslint/no-inferrable-types` report without fixing too, so `--fix` leaves API excerpts as written.

For example, `@typescript-eslint/no-meaningless-void-operator`'s fix can join a statement to the line before in code without semicolons, and `better-tailwindcss/enforce-consistent-class-order`'s can change which class tailwind-merge keeps. It still fixes the plain string `class` attribute of a native element in `.astro` files, and `better-tailwindcss/no-unnecessary-whitespace` still fixes a plain, single-line string that isn't joined with `+`.

These rules also only report in files without type information, for array-likes and for APIs newer than the runtime, such as `Promise.try`, which the type checker reports elsewhere. Those files are JavaScript files, Astro scripts, `.astro` files outside folders with a `tsconfig.json`, code blocks and every file with `typeAware: false`.

<details>
<summary>Report-only rules without type information</summary>

`@typescript-eslint/consistent-type-imports`, `e18e/prefer-array-at`, `unicorn/consistent-date-clone`, `unicorn/no-array-method-this-argument`, `unicorn/no-await-expression-member`, `unicorn/no-new-buffer`, `unicorn/no-unnecessary-string-trim`, `unicorn/no-unreadable-array-destructuring`, `unicorn/no-useless-coercion`, `unicorn/prefer-array-from-async`, `unicorn/prefer-at`, `unicorn/prefer-class-fields`, `unicorn/prefer-dom-node-append`, `unicorn/prefer-dom-node-remove`, `unicorn/prefer-iterable-in-constructor`, `unicorn/prefer-modern-dom-apis`, `unicorn/prefer-promise-try`, `unicorn/prefer-promise-with-resolvers`, `unicorn/prefer-prototype-methods`, `unicorn/prefer-reflect-apply`, `unicorn/prefer-regexp-test`, `unicorn/prefer-set-methods`, `unicorn/prefer-string-starts-ends-with`, `unicorn/prefer-toggle-attribute`, `unicorn/prefer-url-can-parse`, `unicorn/require-array-join-separator`, `unicorn/switch-case-braces`, `unicorn/throw-new-error`.

</details>

`@typescript-eslint/consistent-type-imports` needs type information to see `emitDecoratorMetadata`; without it, its fix can turn an import that decorator metadata loads at run time into a type import.

### Duplicate rules

Where two rules report the same thing, the presets keep one and turn its twin off in the files where the kept rule runs. Turning the kept rule off leaves the twin off too, so turn the twin on yourself if you want it: after turning `unicorn/prefer-at` off, add `'e18e/prefer-array-at': 'error'`. [The rule registry](https://github.com/gpahal/jslib/blob/main/packages/eslint-config/src/internal/duplicate-rules.ts) records replacements and intentional overlaps. `@typescript-eslint/non-nullable-type-assertion-style`, which fixes `x as string` into `x!`, runs only in test files, where non-null assertions are allowed.

Where neither rule covers the other, both stay on, and in the files where the kept rule is on, its twin's report on the same code is dropped. A disable comment for the kept rule covers the code and doesn't bring the twin's report back.

| Code | Reported by | Not by |
| --- | --- | --- |
| `if (promise)` | `strict-boolean-expressions`, `no-unnecessary-condition` | `no-misused-promises` |
| `{count && <p />}` | `@eslint-react/no-leaked-conditional-rendering` | `strict-boolean-expressions` |
| An unused `catch (error)` | `unicorn/prefer-optional-catch-binding` | `no-unused-vars`, `unicorn/catch-error-name` |
| `interface A extends B {}` | `no-empty-object-type`, with `consistent-type-definitions` only where it fixes it | `consistent-type-definitions` elsewhere |
| `x as any` | `no-explicit-any` | `no-unsafe-type-assertion` |
| `throw Error('x')` | `unicorn/throw-new-error` | `unicorn/new-for-builtins` |
| `Object()` | `no-object-constructor` | `unicorn/new-for-builtins` |
| `Object.assign({}, a)` | `prefer-object-spread` | `e18e/prefer-spread-syntax` |
| A class's getter and setter apart | `adjacent-overload-signatures` | `grouped-accessor-pairs` |
| `a?.b!` | `no-non-null-asserted-optional-chain` | `no-non-null-assertion` |
| `new Buffer(10)`, with `node` | `unicorn/no-new-buffer` | `n/no-deprecated-api` |
| `localStorage` in `server` files, with `node` | `@gpahal/no-browser-globals` | `n/no-unsupported-features/node-builtins` |
| `window` and `self` in `server` files | `@gpahal/no-browser-globals` | `unicorn/prefer-global-this` |
| `expect(p).resolves.toBe(1)` without `await` | `vitest/valid-expect` | `no-floating-promises` |

`unicorn/explicit-length-check` runs only in files without type information, where `strict-boolean-expressions` doesn't.

### Own rules

| Rule | Reports |
| --- | --- |
| `@gpahal/comment-layout` | A comment laid out against its place: a `/**` doc block where TypeScript reads one, and `//` lines elsewhere, as [comment layout](#comment-layout) describes |
| `@gpahal/nextjs-server-component` | With `nextjs`, in a route entry file of an `app` or `src/app` folder without `'use client'`: a browser global that Node lacks, such as `window` or `globalThis.window`, except under `typeof`, and a client-only hook of React or `next/navigation`, such as `useState()` or `usePathname()`, matched by name. The entry files are `page`, `layout`, `template`, `loading`, `not-found`, `default` and `route`; an `error` or `global-error` file without `'use client'` is reported too, since error boundaries must be client components. Imported components aren't checked. No fix |
| `@gpahal/no-bidi-characters` | A Unicode bidirectional control character, U+202A–U+202E or U+2066–U+2069, anywhere in a file of any language, which can make text display in another order than it runs, as in Trojan Source (CVE-2021-42574). The implicit marks, such as U+200F, aren't reported. No fix; in a string, write the escape, such as `\u202E` |
| `@gpahal/no-inline-type-only-export` | `export { type A }`, fixed to `export type { A }` |
| `@gpahal/no-js-specifier-for-ts` | With `node: { typeStripping: true }`, a relative `./b.js`, `./b.mjs` or `./b.cjs` specifier of an import, `require()`, `require.resolve()` or `import.meta.resolve()`, where no such file exists but `./b.ts`, `./b.mts` or `./b.cts` does, fixed to the TypeScript file |
| `@gpahal/no-unstrippable-syntax` | With `node: { typeStripping: true }`, syntax that Node's type stripping can't run: named `module` declarations, and outside ambient declarations, enums, namespaces with values, parameter properties, `import x = require('x')`, `export = x`, decorators and `accessor` fields other than `abstract accessor`. `@typescript-eslint/consistent-type-assertions` reports `<T>value` assertions |
| `@gpahal/no-esm-in-commonjs` | `import`, `export` and `import.meta` in `.cjs` files |
| `@gpahal/no-node-globals`, `@gpahal/no-node-global-properties` | Node's globals in `browser` files and Astro `<script>` blocks, except as the operand of `typeof`, and `import.meta.dirname`, `import.meta.filename` and `globalThis.process.<x>`, also through `window` or `self`, for any `x` but `env` in `browser` files |
| `@gpahal/no-node-imports`, `@gpahal/no-node-dynamic-imports` | Imports of Node's built-in modules in `browser` files and Astro `<script>` blocks |
| `@gpahal/no-browser-globals`, `@gpahal/no-browser-global-properties` | Browser globals that Node lacks in `server` files, except as the operand of `typeof` |

#### Comment layout

`@gpahal/comment-layout` checks comments in JavaScript and TypeScript files, and in `.astro` files with `astro`, but not in Markdown code blocks:

- **Doc blocks.** Module-level declarations, type, class and enum members, and the cases of a type alias's union take a `/**` doc block. Object-literal members, nested functions, function and type parameters, and, in JavaScript files, assignments that TypeScript reads JSDoc on, such as `exports.x = …`, may take one.
- **Blocks that stay.** The module header, a block at the top of the file or after its imports, stays a `/**` block, and so does a block with a JSDoc tag, such as `@deprecated`. A `/**` block that only blank lines separate from a declaration or member is its doc block, as TypeScript reads it.
- **Fixes.** Any other `/**` block becomes `//` lines. A multi-line JSX comment is a `/* */` block laid out JSDoc-style. A `/**` comment that reads as a directive is reported without a fix. No fix or suggestion moves a `@ts-expect-error` or `@ts-ignore` off its code.
- **Suggestions.** A `//` comment above a declaration may label a section, so making it a doc block is an editor suggestion, not a fix, as is moving code beside a doc block to its own line or moving a doc block after code onto the line above.
- **Not reported.** License and attribution notices, comments with a `TODO`, `FIXME`, `HACK`, `XXX`, `BUG`, `NOTE` or `NB` marker, banner lines, commented-out code, `//` comments of only a URL, and leading `@typedef`, `@callback` and `@import` blocks. In Astro `<script>` blocks, comments are reported without fixes or suggestions, since eslint-plugin-astro doesn't indent a fix's lines back.

`--fix` leaves the suggestions, which can be most of the reports on an existing codebase: apply them in an editor, or disable the rule while adopting the config.

### Markdown rules

The `markdown` area lints `.md` and `.markdown` files with GitHub's flavour and YAML or TOML front matter, and their code blocks as virtual files such as `README.md/1_0.tsx`, without type information. A block's language is matched in any case and up to its first character other than a letter, digit, `_`, `+`, `#` or `-`, so ` ```TypeScript ` is linted as `.ts`, and ` ```js{1} ` as `.js`. Your config that can apply to Markdown files and sets `languageOptions.frontmatter` or `languageOptions.math` throws, since the processor that finds the code blocks parses with fixed options.

Write `<!-- eslint-skip -->`, or `<!-- eslint-skip -- reason -->`, before a block to skip it. A directive comment right before a block, such as `<!-- eslint-disable-next-line rule -- reason -->` or `<!-- global foo -->`, applies to the block too, written into it as a comment of its language:

| Block | Directive written as |
| --- | --- |
| JavaScript, TypeScript | `/* … */` at the start, after a shebang line |
| JSON | `/* … */` at the start |
| YAML, TOML | `# …` at the start, so only single-line directives, and one `eslint-disable-next-line` |
| Markdown, HTML | `<!-- … -->` at the start, after a Markdown block's front matter |
| Astro | `/* … */` after the opening `---` of its front matter, so a block without front matter takes none |

Blocks of other languages, such as `sh`, take no directives, and nor do blocks whose area is off. Other HTML comments, such as `<!-- prettier-ignore -->`, can come between a directive and the block. Every `eslint-disable-next-line` before a block applies to its first line of code. A directive before a block is reported unused only for the rules that neither the file's lint nor the block's uses.

| Rule | Reports |
| --- | --- |
| `@gpahal/markdown/canonical-code-block-language` | A code block language that is an alias, fixed to the canonical name, such as `sh` for `shell`. `bash` stays |
| `@gpahal/markdown/directive-placement` | A directive comment right before a code block that isn't applied to it: one before a block without directives that the Markdown file's lint doesn't use, one containing `*/` before a block whose directives become `/* … */` comments, a multi-line one before a YAML or TOML block, and a second `eslint-disable-next-line` before one |
| `@gpahal/markdown/heading-increment` | A heading more than one rank below the closest heading of a lower rank above it. HTML `<h1>`–`<h6>` headings count, and a top-level front matter `title` counts as rank 1. `frontmatterTitle` sets the pattern of the title line, and an empty one turns the check of front matter off |
| `@gpahal/markdown/lowercase-code-block-language` | A code block language that isn't lower-case, such as `JS`, fixed to `js` |
| `@gpahal/markdown/max-heading-length` | A heading longer than `max` code points, 80 by default |
| `@gpahal/markdown/no-bare-urls` | A bare URL that `@gpahal/markdown/prefer-autolinks` doesn't report, such as `www.example.com` |
| `@gpahal/markdown/no-emphasis-as-heading` | A paragraph of only bold or italic text used as a heading, unless the text ends in punctuation, as in `**Note:**`, or the paragraph is in a list item |
| `@gpahal/markdown/no-missing-atx-heading-space` | A line such as `#Usage:`, fixed to `# Usage:`, or `#Install guide` and `#[derive(Debug)]`, with a suggestion. A lone `#word` is a tag and isn't reported, nor is a hex color such as `#ff00ff` or a C directive such as `#define` |
| `@gpahal/markdown/no-missing-label-refs` | A full reference, `[text][label]`, a collapsed one, `[label][]`, or a footnote reference, `[^label]`, without a definition. A shortcut `[label]` isn't checked, since it's often prose, as in `[WIP]` |
| `@gpahal/markdown/no-missing-link-fragments` | A link to `#fragment` that matches no heading or id |
| `@gpahal/markdown/no-multiple-h1` | A rank 1 heading after the first, counting HTML `<h1>` and a top-level front matter `title`. Unlike `markdown/no-multiple-h1`, it doesn't count a nested `title` |
| `@gpahal/markdown/no-shell-dollars` | A shell code block whose every line starts with a `$` prompt |
| `@gpahal/markdown/no-shortcut-reference` | A shortcut reference `[text]`, fixed to `[text][]` |
| `@gpahal/markdown/prefer-autolinks` | A link whose text is its URL, fixed to `<https://example.com>` |
| `@gpahal/markdown/require-alt-text` | An image without alternative text |

A page with a front matter `title:` and a `# H1` gets `@gpahal/markdown/no-multiple-h1`. Drop one, or set the rule's `frontmatterTitle` option to `''` in `markdown.rules`. Turning `prefer-autolinks` off allows a plain `https://example.com` in text, while `no-bare-urls` still reports the cases it covers.

### Known issues

- Plugins' recommended sets, and typescript-eslint's strict and stylistic configs, can add rules in minor releases, which caret ranges admit. Commit your lockfile.
- `@eslint-react/dom-no-unknown-property` is off, so a hyphenated SVG attribute in JSX, such as `stroke-width`, isn't reported, and React logs `Invalid DOM property` at run time. Turn it on with `react: { rules: { '@eslint-react/dom-no-unknown-property': 'error' } }`; its fix renames them, as `stroke-width` to `strokeWidth`.
- The `astro` preset doesn't report `target="_blank"` without `rel="noopener"`, or a `<button>` without `type`, since eslint-plugin-astro has no rules for them.
- `import-x/no-extraneous-dependencies` in eslint-plugin-import-x 4.17.1 crashes on a file with no `package.json` at or above it.
- eslint-plugin-astro's `astro/jsx-a11y/*` rules crash on an attribute named like an `Object.prototype` key, such as `constructor`, and don't check template-literal and shorthand attributes.
- astro-eslint-parser gives template JSX the error type unless `@types/react` is installed, and `Astro.props` in pages with `getStaticPaths` too, so the `@typescript-eslint/no-unsafe-*` rules and `restrict-template-expressions` are off in `.astro` files, not in their `<script>` blocks. `unicorn/prefer-module` is off there too, since frontmatter may `return Astro.redirect()`, and `astro/no-unused-css-selector` isn't on, since it can't see a child component's elements.
- `n/no-unsupported-features/*` report a name in a type, such as `Response` in `Promise<Response>`, so the `node` preset drops reports in type positions.
- eslint-plugin-sonarjs depends on TypeScript itself, so a lockfile can give it another copy than typescript-eslint's, and `defineConfig` warns with `GPAHAL_SONARJS_TYPESCRIPT_COPY`.
- `unicorn/prefer-top-level-await` is off in browser code. If your bundler targets `es2022` or later, turn it on in `configs`, which come after the exemption, as in `configs: [{ files: ['src/**'], rules: { 'unicorn/prefer-top-level-await': 'error' } }]`.
- `@gpahal/markdown/no-missing-link-fragments` makes heading ids with github-slugger, so a site generator with another slugger, such as VitePress, gets reports on valid links. Turn the rule off in `markdown.rules` for such docs, or use the generator's `{#id}` heading syntax.
- `typescript.library` doesn't report every error of TypeScript's `isolatedDeclarations`, so turn that option on in the library's tsconfig, as `@gpahal/tsconfig`'s `library` does.
- Files with an uppercase extension, such as `App.TSX`, aren't linted: the presets' globs match lowercase extensions, as ESLint's defaults do.
- `better-tailwindcss/no-unknown-classes` reports classes that plain CSS defines. List them in its `ignore` option, as in `tailwindcss: { entryPoint, rules: { 'better-tailwindcss/no-unknown-classes': ['error', { ignore: ['^card$'] }] } }`. ESLint checks class order in JavaScript and TypeScript files only in string variables, such as `className`; prettier-plugin-tailwindcss sorts the rest.
- ESLint records every applicable suppression for every report, so thousands of overlapping `eslint-disable` comments can use a lot of memory. Prefer `eslint-disable-next-line` or bounded blocks in generated files.

[Browser and server code]: #browser-and-server-code
[Composer methods]: #composer-methods
[Config order]: #config-order
[Duplicate rules]: #duplicate-rules
[Lint a CommonJS package]: #lint-a-commonjs-package
[Lists and merging]: #lists-and-merging
[Options]: #options
[Preset scopes]: #preset-scopes
[Report-only fixes]: #report-only-fixes
[Set up a monorepo]: #set-up-a-monorepo
[Setups]: #setups
[Startup cost]: #startup-cost
[Typed config files]: #typed-config-files
[Where your configs apply]: #where-your-configs-apply
