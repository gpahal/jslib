# @gpahal/prettier-config

Shared Prettier config with sorted imports and `package.json` keys, and optional Astro and Tailwind CSS support.

- [Install](#install)
- [Quick start](#quick-start)
  - [What changes program text](#what-changes-program-text)
- [Common tasks](#common-tasks)
  - [Astro with Tailwind CSS](#astro-with-tailwind-css)
  - [Sort classes in your own helpers](#sort-classes-in-your-own-helpers)
  - [Keep imports where they are][]
  - [Keep a Markdown code block as it is](#keep-a-markdown-code-block-as-it-is)
  - [Set the import order][]
  - [Change an option](#change-an-option)
  - [Override some files][]
  - [Merge with another config](#merge-with-another-config)
  - [Use a CommonJS config](#use-a-commonjs-config)
  - [Speed up repeated runs](#speed-up-repeated-runs)
- [Reference][]
  - [Options](#options)
  - [Preset settings][]
  - [Tailwind CSS][]
  - [Overrides][]
  - [Plugins that conflict][]
  - [Merging configs][]
  - [Markdown files][]
  - [JSON with comments][]
  - [Known issues](#known-issues)

## Install

```sh
pnpm add -D @gpahal/prettier-config prettier
```

Requires Node 24.22 or later and Prettier `^3.9`. The `astro` option needs `prettier-plugin-astro` `^1.1`, and `tailwindcss` needs `prettier-plugin-tailwindcss` `>=0.8.0 <0.9.0`, both optional peers. With an older Prettier, as npm's `--legacy-peer-deps` allows, the config warns once with the code `GPAHAL_PRETTIER_OLD_PRETTIER`, since some files may be formatted wrongly without an error.

## Quick start

The simplest start names the static default config in `package.json`:

```json
{
  "prettier": "@gpahal/prettier-config"
}
```

It takes no options. Prettier reads the `prettier` key in `package.json` before a config file, so remove the key when you switch to a `prettier.config.mjs`.

A config that spreads the static config merges as Prettier does: your `overrides` replace the preset's whole list, so spread the preset's overrides before yours:

```js
// prettier.config.mjs
import prettierConfig from '@gpahal/prettier-config'

export default {
  ...prettierConfig,
  overrides: [...prettierConfig.overrides, { files: 'scripts/**', options: { semi: true } }],
}
```

For options, or to keep the preset's plugins in your overrides, use `defineConfig`:

```js
// prettier.config.mjs
import { defineConfig } from '@gpahal/prettier-config'

export default defineConfig({ root: import.meta.dirname })
```

`root` is the folder from which relative `entryPoint` paths and plugin paths and names resolve. Set it when Prettier gets the config through `--config` or an editor's config path setting, or when another file or package shares the config; otherwise a relative Tailwind `entryPoint` resolves from the wrong folder.

### What changes program text

Three plugins reorder text: import sorting reorders imports, `package.json` sorting reorders keys, and Tailwind sorting reorders classes. Reordered imports run in a new order, so for code whose imports depend on initialization order, see [Keep imports where they are][].

The import sorter also prints every import again, so an import attribute written as `assert { type: 'json' }` becomes `with { type: 'json' }`. Node before 18.20, Node 20 before 20.10, and TypeScript before 5.3 accept only `assert`; on those, set `sortImports: false`.

## Common tasks

### Astro with Tailwind CSS

```js
// prettier.config.mjs
import { defineConfig } from '@gpahal/prettier-config'

export default defineConfig({
  root: import.meta.dirname,
  astro: true,
  tailwindcss: { entryPoint: 'src/styles/global.css' },
})
```

`entryPoint` is your Tailwind CSS entry stylesheet. The Tailwind plugin doesn't sort classes in `.astro` files, so turn on the `astro` and `tailwindcss` options of [`@gpahal/eslint-config`](https://github.com/gpahal/jslib/tree/main/packages/eslint-config#readme), which report unsorted classes there.

### Sort classes in your own helpers

```js
// prettier.config.mjs
import { defineConfig } from '@gpahal/prettier-config'

export default defineConfig({
  root: import.meta.dirname,
  tailwindcss: { functions: (defaults) => [...defaults, 'classNames'] },
})
```

`functions` and `attributes` take an array, which replaces the defaults, or a function, which gets a copy of them. `functions` defaults to the class-name helpers eslint-plugin-better-tailwindcss checks, such as `cn` and `twMerge`, but not its `twc` and `twx` tagged templates. `attributes` has no defaults; the plugin always adds its own, such as `class` and `className`.

### Keep imports where they are

```js
// prettier.config.mjs
import { defineConfig } from '@gpahal/prettier-config'

export default defineConfig({ root: import.meta.dirname, sortImports: false })
```

Sorting moves imports, which changes the order modules run in. In this file, sorting puts `./db` before `./env`, so the database client reads `process.env` before `./env` loads it:

<!-- prettier-ignore -->
```ts
// src/main.ts
// `./env` loads `.env` into `process.env` when imported, and `./db` reads it when imported
import { env } from './env'
import { db } from './db'

export const app = { env, db }
```

The sorter doesn't move imports across a bare import such as `import './setup'`, or an import under `// prettier-ignore`. Without `tailwindcss`, it doesn't move an import under a directive either: a comment right above it that contains `@ts-expect-error`, `@ts-ignore`, `eslint-disable-next-line`, `eslint-disable-line`, `biome-ignore` or `prettier-ignore`. A re-export such as `export * from './setup'` doesn't stop it, so its module runs after the imports moved above it.

To keep imports where they are in some files only, set an empty `importOrder` in an override:

```js
// prettier.config.mjs
import { defineConfig } from '@gpahal/prettier-config'

export default defineConfig({
  root: import.meta.dirname,
  overrides: [{ files: 'legacy/**', options: { importOrder: [] } }],
})
```

### Keep a Markdown code block as it is

<!-- eslint-skip -->

````md
<!-- prettier-ignore -->
```ts
import { b } from './b'
import fs from 'node:fs'
import { a } from './b'
```
````

Place `<!-- prettier-ignore -->` immediately before the fence to keep a block, including its import order.

### Set the import order

```js
// prettier.config.mjs
import { defineConfig } from '@gpahal/prettier-config'

export default defineConfig({
  root: import.meta.dirname,
  sortImports: {
    importOrder: ['<BUILTIN_MODULES>', '', '<THIRD_PARTY_MODULES>', '', '^(@/|~/|#)', '', '^[./]'],
  },
})
```

An array replaces the default order, and each empty string is a blank line between groups. A function, such as `(defaults) => ['^@acme/(.*)$', '', ...defaults]`, gets a copy of the default order, which [Preset settings][] lists.

To sort bare imports that are safe to move, list their sources as regular expressions in the sorter's `importOrderSafeSideEffects`:

```js
// prettier.config.mjs
import { defineConfig } from '@gpahal/prettier-config'

export default defineConfig({
  root: import.meta.dirname,
  sortImports: { importOrderSafeSideEffects: [String.raw`\.css$`] },
})
```

### Change an option

```js
// prettier.config.mjs
import { defineConfig } from '@gpahal/prettier-config'

export default defineConfig({
  root: import.meta.dirname,
  options: { printWidth: 120 },
  markdown: { proseWrap: 'always' },
})
```

`options` apply to every file and win over the preset's, and `markdown` and `astro` win over `options` in their files. One exception: `options.proseWrap` wins over the Markdown files' `proseWrap: 'never'`, since the preset copies it into its Markdown override. `mergeConfigs` doesn't, so `mergeConfigs(defineConfig({ root: import.meta.dirname }), { proseWrap: 'always' })` keeps `'never'` in Markdown files.

### Override some files

```js
// prettier.config.mjs
import { defineConfig } from '@gpahal/prettier-config'

export default defineConfig({
  root: import.meta.dirname,
  overrides: [{ files: 'vendor/**', options: { semi: true } }],
})
```

Your overrides go after the preset's, so they win, and `options.overrides` come after `overrides`. [Overrides][] covers their keys and `plugins`.

### Merge with another config

```js
// prettier.config.mjs
import { defineConfig, mergeConfigs } from '@gpahal/prettier-config'

import teamConfig from './team.prettier.config.mjs'

export default mergeConfigs(defineConfig({ root: import.meta.dirname }), teamConfig)
```

Later options win, overrides concatenate in order, and plugins are deduplicated and ordered as with `tailwindcss`. Pass a module's default export: a module namespace, as `import * as teamConfig` gives, throws. So does a plugin given by name that `defineConfig` already adds, such as `prettier-plugin-packagejson`. [Merging configs][] covers plugins and overrides.

### Use a CommonJS config

The package is an ES module. In a `prettier.config.cjs`, take `defineConfig` or the default export from `require`:

<!-- eslint-skip -->

```js
// prettier.config.cjs
const { defineConfig } = require('@gpahal/prettier-config')

module.exports = defineConfig({ root: __dirname })
```

`require('@gpahal/prettier-config').default` gives the static default. `require('@gpahal/prettier-config')` alone gives the module namespace, whose `default` key Prettier ignores, so it formats with its own defaults.

### Speed up repeated runs

Import sorting parses each JavaScript and TypeScript file once more, which added about 55% to a full `prettier --check` of a 6,100-file project. Prettier's `--cache` skips the files that haven't changed since the last run:

```sh
prettier --check --cache .
```

## Reference

### Options

| Option | Default | What it does |
| --- | --- | --- |
| `root` | unset | Absolute path of an existing folder. Relative `tailwindcss.entryPoint` paths, dot-prefixed plugin paths and plugin package names resolve from it, and a relative `entryPoint` must exist when the config loads. A plugin name that isn't installed at or above it is left as it is. Without it, Prettier and the Tailwind plugin resolve them, as [Tailwind CSS][] describes |
| `astro` | off | Adds `prettier-plugin-astro`. An object is options for `.astro` files |
| `tailwindcss` | off | Adds `prettier-plugin-tailwindcss`. Keys: `entryPoint`, `functions`, `attributes`, `preserveWhitespace`. The plugin's other options, such as `tailwindPreserveDuplicates`, go in `options` |
| `sortImports` | on | Sorts imports with `@ianvs/prettier-plugin-sort-imports`. Takes `importOrder` and the sorter's other exported options, checked against the sorter Prettier loads: with `tailwindcss`, the copy the Tailwind plugin finds. Unknown keys throw |
| `githubAlerts` | on | Keeps a GitHub alert marker such as `> [!NOTE]` on its own line |
| `packageJson` | on | Sorts `package.json` keys with `prettier-plugin-packagejson`, and some nested fields, such as `scripts` |
| `markdown` |  | Options for the [Markdown files][]. `true` and `false` throw; to leave Markdown files unformatted, list them in `.prettierignore` |
| `options` |  | Options for every file. Their `plugins` add to the preset's |
| `overrides` |  | Your overrides, after the preset's. Their `plugins` add to the preset's |

Prettier's own options, such as `printWidth` and `semi`, go in `options`: at the top level they throw, as does any other unknown key, with a suggestion when it's close to an option's name. Keys inside `options` aren't checked, since plugins add their own.

`markdown`, `astro` and `options` reject the keys the preset's options set: the `importOrder*` keys go in `sortImports`, the Tailwind plugin's `tailwindFunctions`, `tailwindAttributes`, `tailwindStylesheet`, `tailwindEntryPoint` and `tailwindPreserveWhitespace` in `tailwindcss`, and the preset's own options at the top level. Overrides reject only the preset's own options, so an override can set a sorter or Tailwind key for its files. `markdown` and `astro` also reject `plugins`, `overrides`, `files` and `excludeFiles`. To set a sorter key in Markdown or Astro files only, use an override such as `{ files: '*.md', options: { importOrder: [] } }`.

`defineConfig` throws a `TypeError` on invalid options and on the plugins in [Plugins that conflict][]. It also rejects a second copy of a plugin the preset adds, in `options.plugins` or an override's `plugins`: the import sorter while `sortImports` is on, `prettier-plugin-packagejson` while `packageJson` is on, and `prettier-plugin-astro` with `astro`. A missing optional plugin throws an `Error` that names every missing plugin at once, with an npm or pnpm command that installs each in its peer range.

### Preset settings

Every file gets these settings, which win over `.editorconfig`:

| Option           | Value                                                            |
| ---------------- | ---------------------------------------------------------------- |
| `printWidth`     | `100`                                                            |
| `semi`           | `false`                                                          |
| `singleQuote`    | `true`                                                           |
| `jsxSingleQuote` | `false`, Prettier's default, so JSX attributes get double quotes |
| `trailingComma`  | `'all'`, Prettier's default                                      |
| `tabWidth`       | `2`                                                              |
| `useTabs`        | `false`                                                          |
| `endOfLine`      | `'lf'`                                                           |

Some files get more:

| Files | Settings |
| --- | --- |
| Code | Imports sorted into groups, with a blank line between groups: Node built-ins and other scheme imports, such as `bun:test` and `cloudflare:workers`; `react`, `react-dom`, `react-native`, `next` and `astro`, with `astro:` imports; other packages, with `npm:`, `jsr:` and `https:` imports; `@gpahal/*`; `@/public` and `@/common`; `@/types`, `@/config`, `@/lib`, `@/actions`, `@/contexts`, `@/hooks`, `@/layouts`, `@/pages`, `@/components/lib`, `@/components`, `@/styles`, `@/assets`, other `@/*`, `~/*` and `#*`; then relative imports. Type and value imports from one module merge |
| [Markdown files][] | One line per paragraph (`proseWrap: 'never'`) |
| [JSON with comments][] | No trailing commas |
| `.mdx` | Left as they are unless they start with a `{/* @format */}` pragma, since Prettier's MDX parser reads MDX 1, and its output can render differently in MDX 2 and 3. To format them all, add the override `{ files: '*.mdx', options: { requirePragma: false } }` |
| `pnpm-lock.yaml`, `next-env.d.ts`, `routeTree.gen.ts`, `convex/_generated/**`, `worker-configuration.d.ts`, `eslint-suppressions.json` | Left as the tools write them, since they rewrite any change on their next run |

### Tailwind CSS

A relative `tailwindcss.entryPoint` resolves from `root` when it's set. Without `root`, the Tailwind plugin resolves it from the folder of the config file that Prettier finds by searching up from the formatted file, not from a config file given with `--config` or an editor's setting. There, set `root: import.meta.dirname`, or pass a `file:` URL, such as `import.meta.resolve('./src/styles/global.css')`. The file must exist.

With Tailwind on, `defineConfig` throws a `TypeError` if `prettier-plugin-tailwindcss` is older than 0.8, or if it would load no import sorter, or one older than 4.7. An insiders build, versioned `0.0.0-insiders.<commit>`, is accepted. A version from 0.9 on gets a warning, once, with the code `GPAHAL_PRETTIER_UNTESTED_TAILWIND_PLUGIN`, since the config relies on how the plugin composes the import sorter.

The Tailwind plugin loads the sorter from its own folder. Under pnpm with `hoist: false`, `autoInstallPeers: false` and `dedupePeerDependents: false`, it can't, and `defineConfig` throws: install `@ianvs/prettier-plugin-sort-imports` directly or set `sortImports: false`.

### Overrides

An override needs `files`, a glob or a non-empty array of globs, and takes `excludeFiles`, also a glob or a non-empty array of globs, and `options`. Any other key throws. Globs resolve from the config file's folder.

An override's `plugins` add to the preset's and `options.plugins`, deduplicated and ordered as with `tailwindcss`, so its files keep import sorting. Prettier would otherwise replace the config's plugins with them in those files. `plugins: []` adds none and removes none. An override rejects `prettier-plugin-tailwindcss`; turn it on with `tailwindcss`.

Plugins don't combine across overrides: for a file that two overrides with `plugins` match, Prettier applies the later list in place of the earlier one. Put a plugin that adds a language in `options.plugins`.

### Plugins that conflict

Prettier formats a file with the parser of the last plugin that defines one for its language, so a plugin with its own JavaScript or TypeScript parsers replaces the import sorter's or the Tailwind plugin's, and imports or classes stay unsorted without an error. `defineConfig` and `mergeConfigs` throw a `TypeError` on the known cases, in `options.plugins`, an override's `plugins` or a merged config's:

| Plugin | Throws | Fix |
| --- | --- | --- |
| `prettier-plugin-jsdoc` | While `sortImports` is on, unless `tailwindcss` is off and `prettier-plugin-merge` comes after it | Add `prettier-plugin-merge` after it, which runs the sorter and then the plugin, or set `sortImports: false` |
| `@prettier/plugin-oxc` | As for `prettier-plugin-jsdoc` | Leave it out of `plugins` and set `parser: 'oxc-ts'` (or `'oxc'`) in an override; the sorter's own `oxc-ts` parser loads `@prettier/plugin-oxc`. Or use a fix for `prettier-plugin-jsdoc` |
| `prettier-plugin-classnames` | Without `tailwindcss`, as for `prettier-plugin-jsdoc`. With `tailwindcss`, while `sortImports` is on, and without `prettier-plugin-merge` after it | Without `tailwindcss`, as for `prettier-plugin-jsdoc`. With it, set `sortImports: false` and add `prettier-plugin-merge` |
| `prettier-plugin-organize-imports` | While `sortImports` is on, and before `prettier-plugin-merge`, which formats with each plugin as a range that this plugin skips | Set `sortImports: false`, without `prettier-plugin-merge` after it |
| `prettier-plugin-merge` | With `tailwindcss` while `sortImports` is on, since it reads every parser of the sorter that the Tailwind plugin loads, including ones for plugins that aren't installed | Set `sortImports: false` |

The plugins are recognized by package name, by a path into their package, or by a `URL` or `file:` URL string; plugin objects aren't. Each plugin counts once, where it first appears. An override's plugins follow `options.plugins` in its files.

### Merging configs

The root README's [Lists and merging](https://github.com/gpahal/jslib#lists-and-merging) summarizes the merge rules. A later config can't remove an earlier config's plugins. A plugin name that `defineConfig` resolved from `root` counts once with another config's same name, when `mergeConfigs` gets the config `defineConfig` returned rather than a copy. Turn the Tailwind plugin on with `defineConfig`'s `tailwindcss` rather than in a merged config: `mergeConfigs` throws on a Tailwind plugin when a config's import sorter is the wrapper that `defineConfig` adds without `tailwindcss`, which the Tailwind plugin can't compose. It throws on the plugins in [Plugins that conflict][] too, across all the configs, and on a plugin given by name that a `defineConfig` config adds itself: the import sorter, `prettier-plugin-packagejson`, `prettier-plugin-astro` or `prettier-plugin-tailwindcss`. Prettier would load both copies, and the named one would replace the preset's, such as the import sorter's wrapper. Configs that `defineConfig` returned merge, each of their plugins kept once.

An override's `plugins` add to the merged config's plugins, including those of later configs. Here, the files in `docs/` get a local plugin and keep import sorting and the team config's plugins:

```js
// prettier.config.mjs
import { defineConfig, mergeConfigs } from '@gpahal/prettier-config'

import teamConfig from './team.prettier.config.mjs'

export default mergeConfigs(
  defineConfig({ root: import.meta.dirname }),
  { overrides: [{ files: 'docs/**', options: { plugins: ['./prettier-plugin-docs.mjs'] } }] },
  teamConfig,
)
```

Prettier resolves a dot-prefixed plugin path from the folder of the config file it loads. A shared config should pass `import.meta.resolve('./prettier-plugin-docs.mjs')`, which points to the plugin wherever the config is used:

```js
// team.prettier.config.mjs
export default {
  overrides: [
    { files: 'docs/**', options: { plugins: [import.meta.resolve('./prettier-plugin-docs.mjs')] } },
  ],
}
```

### Markdown files

The files with an extension or filename of Prettier's `markdown` language, such as `.md`, `.markdown` and `README`. Files you map to the `markdown` parser yourself, such as `*.mdc`, get neither the `markdown` options nor `proseWrap: 'never'`; set them in your override.

### JSON with comments

Every file Prettier parses as JSON with comments, including `.jsonc` and editor config files, gets `trailingComma: 'none'`; use [overrides][Override some files] to change it. Code blocks in Markdown, and files you map to `jsonc` yourself, keep the `trailingComma` of the Markdown or override options.

### Known issues

- A comment above the first import stays at the top of the file when sorting moves that import. With `tailwindcss`, the Tailwind plugin loads the sorter itself, so a directive such as `// @ts-expect-error` above the first import then applies to another import. Put `// prettier-ignore` directly above or below the directive to keep that import first.
- A trailing comment on an import, as in `import { z } from 'zod' // note`, can add a blank line inside its group. The output is still stable.
- Sorting `package.json` drops a `"__proto__"` key, and of two keys with the same name keeps only the last. Set `packageJson: false` to keep them.
- `prettier-plugin-merge` fails with `tailwindcss` while `sortImports` is on; see [Plugins that conflict][].

[JSON with comments]: #json-with-comments
[Keep imports where they are]: #keep-imports-where-they-are
[Markdown files]: #markdown-files
[Merging configs]: #merging-configs
[Override some files]: #override-some-files
[Overrides]: #overrides
[Plugins that conflict]: #plugins-that-conflict
[Preset settings]: #preset-settings
[Reference]: #reference
[Set the import order]: #set-the-import-order
[Tailwind CSS]: #tailwind-css
