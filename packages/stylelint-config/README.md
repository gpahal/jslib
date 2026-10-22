# @gpahal/stylelint-config

Shared Stylelint config extending `stylelint-config-standard` and `stylelint-config-recess-order`, with a variant for Tailwind CSS v4. It lints `.css` files, the `<style>` blocks and `style` attributes of `.astro` and `.html` files, and the CSS code blocks and HTML styles of `.md` and `.markdown` files.

- [Install](#install)
- [Quick start](#quick-start)
- [Common tasks](#common-tasks)
  - [Tailwind CSS v4][]
  - [Add a Tailwind function or at-rule](#add-a-tailwind-function-or-at-rule)
  - [Change a rule's options][]
  - [Replace a rule's setting][]
  - [Set a rule for one file type][]
  - [Check custom properties][]
  - [Fix unknown custom property reports][]
  - [Change the Baseline target][]
  - [Fix the property order](#fix-the-property-order)
  - [Ignore files](#ignore-files)
  - [Add a plugin](#add-a-plugin)
  - [Lint SCSS files][]
  - [Run it after Prettier](#run-it-after-prettier)
  - [Skip a code block in Markdown](#skip-a-code-block-in-markdown)
- [Reference](#reference)
  - [Options][]
  - [Rule merging][]
  - [Overrides][]
  - [Reference files][]
  - [Rule changes][]
  - [Tailwind CSS changes][]
  - [Own rules][]
    - [comment-layout](#comment-layout)
    - [media-range-spacing](#media-range-spacing)
    - [tailwind-directives](#tailwind-directives)
    - [tailwind-theme-function](#tailwind-theme-function)
    - [tailwind-apply](#tailwind-apply)
    - [declaration-empty-line-before][]
    - [custom-property-empty-line-before][]
    - [Quote rules][]

## Install

```sh
pnpm add -D @gpahal/stylelint-config stylelint
```

Requires Node 24.22 or later. The `stylelint` peer range is `^17.15`. `tailwindcss`, for the [Tailwind CSS v4][] variant, is an optional peer with the range `^4.3`.

## Quick start

The simplest start extends the static default config:

```js
// stylelint.config.mjs
export default { extends: ['@gpahal/stylelint-config'] }
```

Extend `@gpahal/stylelint-config/tailwindcss` for the [Tailwind CSS v4][] variant. Under `extends`, Stylelint merges as it does for any config: a rule you set replaces the preset's whole setting, its secondary options included. See [declaration-empty-line-before][] and [custom-property-empty-line-before][].

For options with paths, such as a Tailwind entry stylesheet or reference files, or to merge your rule settings with the preset's, use `defineConfig`:

```js
// stylelint.config.mjs
import { defineConfig } from '@gpahal/stylelint-config'

export default defineConfig({ root: import.meta.dirname })
```

A `stylelint.config.ts` works too, but Stylelint loads it through cosmiconfig, which needs `typescript` installed in the project.

`defineConfig` returns a promise, which Stylelint 17 takes as the default export. Export it without `await`: Stylelint's config loader replaces an error thrown by top-level `await`, such as a rejected option, with `ERR_REQUIRE_ASYNC_MODULE`, while a rejected promise export shows the package's error.

Beyond stylelint-config-standard, a `stylelint-disable` comment needs a reason after `--`, multi-line comments are laid out JSDoc-style (`commentLayout: false` turns that off), and an `entryPoint` or `referenceFiles` turns on `no-unknown-custom-properties`. See [Rule changes][].

Stylelint lints only the files it's given and doesn't read `.gitignore`, so pass both:

```sh
stylelint --ignore-path .gitignore "**/*.{css,astro,html,md,markdown}"
```

Leave other style files out of that glob. Stylelint parses a `.scss`, `.less`, `.vue` or `.svelte` file as CSS unless a `customSyntax` says otherwise, giving errors such as `Unknown at-rule "@use"` or `CssSyntaxError`. [Lint SCSS files][] shows the override that gives one a syntax.

Adopting the preset in an existing codebase, Stylelint's `--suppress` records the current reports in `stylelint-suppressions.json`, so later runs report only new ones. While that file exists, Stylelint prints an `ExperimentalWarning` that the suppressions feature is experimental on every run.

## Common tasks

### Tailwind CSS v4

```js
// stylelint.config.mjs
import { defineConfig } from '@gpahal/stylelint-config'

export default defineConfig({ root: import.meta.dirname, tailwindcss: true })
```

This declares Tailwind's at-rules and functions, allows its theme variable names, checks the structure of its at-rules with [`@gpahal/tailwind-directives`](#tailwind-directives), and lets a declaration follow an `@apply` without an empty line. See [Tailwind CSS changes][]. With an `entryPoint`, it also checks custom properties and `theme()` variables against the theme: see [Check custom properties][]. `validateApply: true` checks the classes of `@apply` and the variants of `@variant` too: see [tailwind-apply](#tailwind-apply).

### Add a Tailwind function or at-rule

```js
// stylelint.config.mjs
import { defineConfig } from '@gpahal/stylelint-config'

export default defineConfig({
  root: import.meta.dirname,
  tailwindcss: {
    functions: (defaults) => [...defaults, 'brand'],
    atRules: (defaults) => [...defaults, 'brand'],
  },
})
```

Both take an array, which replaces the defaults, or a function, which gets a copy of them and returns the list to use. At-rule names go without the `@`. A value with an added function isn't checked, and an added at-rule takes any prelude.

### Change a rule's options

```js
// stylelint.config.mjs
import { defineConfig } from '@gpahal/stylelint-config'

export default defineConfig({
  root: import.meta.dirname,
  rules: { 'selector-pseudo-class-no-unknown': [true, { ignorePseudoClasses: ['deep'] }] },
})
```

Your primary option replaces the preset's, secondary options merge over the preset's and `ignore*` lists add to them. This allows `:deep()` and keeps `:global()` allowed in `.astro` files. `null` turns the rule off, and [Rule merging][] covers the order of settings, `undefined` and the options a changed primary option drops.

### Replace a rule's setting

```js
// stylelint.config.mjs
import { defineConfig, replace } from '@gpahal/stylelint-config'

export default defineConfig({
  root: import.meta.dirname,
  rules: { 'value-no-vendor-prefix': replace([true, { ignoreValues: ['flex'] }]) },
})
```

`replace()` uses the setting as given, dropping the preset's `ignoreValues` and `disableFix`. It throws on `undefined`, where `null` turns the rule off and leaving the key out keeps the setting of the preset or an extended config, and on a setting it already wrapped.

### Set a rule for one file type

```js
// stylelint.config.mjs
import { defineConfig } from '@gpahal/stylelint-config'

export default defineConfig({
  root: import.meta.dirname,
  overrides: [
    {
      files: ['**/*.{astro,html}'],
      rules: { 'selector-pseudo-class-no-unknown': [true, { ignorePseudoClasses: ['custom'] }] },
    },
  ],
})
```

Override rules merge over the preset's settings for their file type, Astro, HTML, Markdown, CSS Modules or CSS, with your top-level `rules` merged in, and over the settings of the override's own `extends` configs. `null` and a setting wrapped with `replace()` don't merge. See [Overrides][] for how globs give the file type.

### Check custom properties

```js
// stylelint.config.mjs
import { defineConfig } from '@gpahal/stylelint-config'

export default defineConfig({
  root: import.meta.dirname,
  tailwindcss: { entryPoint: 'src/styles/global.css' },
  referenceFiles: ['src/styles/tokens.css'],
})
```

`referenceFiles` and `tailwindcss.entryPoint` each turn on `no-unknown-custom-properties`, `no-unknown-custom-media` and `no-unknown-animations`, which knows the reference files' `@keyframes`, the ones in Tailwind's theme, such as `spin`, included. With `tailwindcss` on, they also turn on [`@gpahal/tailwind-theme-function`](#tailwind-theme-function), which checks the variables of `theme()` and `--theme()` calls. `entryPoint` adds the Tailwind entry stylesheet, the files it imports and Tailwind's `theme.css` to the reference files. See [Reference files][] for how imports are followed and theme prefixes are read.

### Fix unknown custom property reports

The reference rules know the custom properties and custom media queries that the reference files define, which is separate from the syntax Stylelint understands. A report of a property that works in the browser is usually one of these:

- A variable set at runtime, such as `--font-geist-sans` from `next/font`, or by a component library or script. Declare it in a reference file.
- A property that a `style` attribute or another `<style>` block of the same file sets. Each block is checked on its own: declare it in a reference file, or use a disable comment.

```js
// stylelint.config.mjs
import { defineConfig } from '@gpahal/stylelint-config'

export default defineConfig({
  root: import.meta.dirname,
  tailwindcss: { entryPoint: 'src/styles/global.css' },
  referenceFiles: ['src/styles/runtime.css'],
})
```

```css
/* src/styles/runtime.css: the variables that next/font sets */
:root {
  --font-geist-sans: initial;
}
```

A property can also go unreported where it isn't set: one defined in a file that the entry point imports under a condition, such as `supports()` or a media query, counts as known everywhere, since imports are followed whatever the condition.

### Change the Baseline target

```js
// stylelint.config.mjs
import { defineConfig } from '@gpahal/stylelint-config'

export default defineConfig({
  root: import.meta.dirname,
  rules: {
    'plugin/use-baseline': [
      undefined,
      { available: 'widely', ignoreSelectors: ['selection'], ignoreAtRules: ['view-transition'] },
    ],
  },
})
```

`plugin/use-baseline` warns about features that aren't Baseline newly available. `available` takes `'widely'`, `'newly'` or a year, such as `2023`, for the features that became newly available that year or earlier. `ignoreSelectors`, `ignoreAtRules` and `ignoreProperties`, whose keys are property names and values the values to ignore, add to the preset's lists, which ignore `user-select`. See the [plugin's options](https://github.com/ryo-manba/stylelint-plugin-use-baseline#optional-secondary-options) for the others.

### Fix the property order

```js
// stylelint.config.mjs
import { defineConfig } from '@gpahal/stylelint-config'

export default defineConfig({
  root: import.meta.dirname,
  rules: { 'order/properties-order': [undefined, { disableFix: false }] },
})
```

`order/properties-order` reports declarations out of the Recess order without fixing them, since reordering can change which declaration wins, such as a `margin` written after `margin-top`. In a codebase you're adopting the preset in, this turns the fix on with the preset's order, so `stylelint --fix` sorts the declarations. Review the diff for a shorthand moved before its longhands, or an `all` moved after the properties it resets. `null` turns the rule off instead.

The Recess order, from stylelint-config-recess-order, puts `all` and positioning first, then display, flex, grid and box model properties, then typography, then visual properties such as backgrounds, transforms, transitions and animations, with no empty lines between its groups. stylelint-config-clean-order is an alternative whose groups go from interaction properties, such as `cursor`, through positioning, layout, box model, typography and appearance to transitions, with empty lines between them. It reports at `warning` severity and fixes by default, and it also sets `order/order`, `declaration-empty-line-before` and `at-rule-empty-line-before`. To use it, add it to `extends`: its settings replace the preset's, as [Rule merging][] describes, and its `declaration-empty-line-before` setting goes to [`@gpahal/declaration-empty-line-before`][declaration-empty-line-before].

### Ignore files

```js
// stylelint.config.mjs
import { defineConfig } from '@gpahal/stylelint-config'

export default defineConfig({
  root: import.meta.dirname,
  ignoreFiles: ['vendor/**'],
})
```

`ignoreFiles` takes a glob, an array of globs, or a function that receives `[]` and returns them. [Options][] describes how the list joins with others.

### Add a plugin

```js
// stylelint.config.mjs
import { defineConfig } from '@gpahal/stylelint-config'

export default defineConfig({
  root: import.meta.dirname,
  plugins: ['stylelint-plugin-logical-css'],
  rules: { 'logical-css/require-logical-properties': true },
})
```

Plugins go after the preset's, and a rule name with a `/` takes options of any type.

### Lint SCSS files

```sh
pnpm add -D postcss-scss stylelint-config-standard-scss
```

```js
// stylelint.config.mjs
import { defineConfig } from '@gpahal/stylelint-config'

export default defineConfig({
  root: import.meta.dirname,
  overrides: [
    {
      files: ['**/*.scss'],
      customSyntax: 'postcss-scss',
      extends: ['stylelint-config-standard-scss'],
    },
  ],
})
```

The override parses `.scss` files with postcss-scss, and stylelint-config-standard-scss swaps the CSS rules that SCSS syntax breaks, such as `at-rule-no-unknown` on `@use`, for their SCSS forms. Add `.scss` to the glob you pass Stylelint.

### Run it after Prettier

Run the fixers in this order:

1. `eslint --fix`, on the files ESLint lints.
2. `prettier --write`.
3. `stylelint --fix`, on Prettier's output.
4. `prettier --write` again, so the files end in Prettier's layout whatever Stylelint's fixes change.

[Running the fixers](https://github.com/gpahal/jslib#running-the-fixers) in the repository README has the scripts for every tool. lint-staged runs a glob's commands in the same order, with ESLint on the files it lints:

```json
{
  "lint-staged": {
    "*.css": ["prettier --write", "stylelint --fix", "prettier --write"],
    "*.{astro,html,md,markdown}": [
      "eslint --fix --no-warn-ignored",
      "prettier --write",
      "stylelint --fix",
      "prettier --write"
    ]
  }
}
```

`--no-warn-ignored` keeps ESLint quiet on HTML files when the `html` preset is off.

### Skip a code block in Markdown

````md
```css
/* stylelint-disable -- shows broken CSS */
a {
  color: #ff00zz;
}
/* stylelint-enable */
```
````

Without the `stylelint-enable`, the code blocks after it are skipped too, and an HTML comment around the block doesn't skip it.

## Reference

### Options

| Option | Default | What it does |
| --- | --- | --- |
| `root` | required | The absolute path of an existing folder, such as `import.meta.dirname`. Relative paths and globs, and module names, resolve from it |
| `tailwindcss` | off | The [Tailwind CSS changes][]. Keys: `functions`, `atRules`, `entryPoint`, `validateApply` |
| `astro`, `html`, `markdown` | on | Lint `.astro`, `.html`, and `.md` and `.markdown` files |
| `commentLayout` | on | The [`@gpahal/comment-layout`][Own rules] rule |
| `logical` | off | Prefers flow-relative properties, units and keywords, as in `margin-inline-start` for `margin-left`, `10vi` for `10vw` and `float: inline-start` for `float: left`, with Stylelint's `property-layout-mappings`, `unit-layout-mappings` and `value-keyword-layout-mappings`. Their fixes map sides as `languageOptions.directionality` gives them, which this sets to horizontal left-to-right text, `{ block: 'top-to-bottom', inline: 'left-to-right' }`, under yours. Your `rules` merge over these settings |
| `plugins` |  | Plugins after the preset's |
| `rules` |  | Rules merged over the preset's settings, in its file type overrides too, except where such an override sets a rule to `null`, as the Markdown one does for snippets. Turn those on with an override |
| `overrides` |  | Overrides after the preset's, their rules merged over the preset's settings for their files and your top-level `rules`. A later override's setting replaces an earlier one's. See [Overrides][] |
| `ignoreFiles` |  | A glob, an array of globs, or a function that receives `[]` and returns them |
| `referenceFiles` |  | Files that define the custom properties, custom media queries and `@keyframes` your files use. See [Reference files][] |
| `extends` |  | Config objects, paths or package names, or an array of them. Loaded recursively in order. Their rules beat the preset's settings, except those of the base configs the preset builds on, and your `rules` merge over theirs, as [Rule merging][] describes; plugins and overrides keep Stylelint's merging. See below for other keys |
| `languageOptions` |  | Deep merge of the preset's, extended configs', then yours. An empty result is omitted |
| `defaultSeverity`, `customSyntax`, `quiet`, `formatter`, `ignoreDisables`, `maxWarnings`, `computeEditInfo`, `configurationComment`, `processors`, `allowEmptyInput`, `cache` |  | Passed to Stylelint |
| `reportNeedlessDisables`, `reportInvalidScopeDisables`, `reportDescriptionlessDisables`, `reportUnscopedDisables` |  | Your setting beats extended configs', which beat the preset's: `[true, { except: ['plugin/use-baseline'] }]` for needless disables, and `true` for invalid scope and descriptionless ones |

Relative paths and globs resolve from `root`, including `referenceFiles`, `ignoreFiles`, override `files`, and module paths in `plugins`, `processors`, `customSyntax` and reference entries. Package names resolve from `root` too. Absolute globs keep their meaning, and negated globs keep their negation.

Stylelint matches `ignoreFiles` and override globs against a file's path as it's given, so lint files through `root` as you give it or through its real path, which `import.meta.dirname` always is: the globs are made for both spellings. A file linted through another symlink to the project, such as an absolute `/tmp/…` path on macOS, where `/tmp` links to `/private/tmp`, or an editor workspace opened through a symlinked folder, doesn't match them, except override globs without a `/`, which match the file's name.

An object's relative paths resolve from `root`. A loaded config's paths and nested `extends` resolve from its own folder, except its override `files`, which match from `root`, as in Stylelint. A path or package specifier in `extends`, `plugins`, `processors` and `customSyntax`, and a reference entry's `customSyntax` and `loader`, also tries it with `.js`, `.json`, `/index.js` and `/index.json` added, as Stylelint does, so `fake-cfg/strict` loads `fake-cfg/strict.js`. A package's `exports` apply to each, so an added suffix can't reach a file the package doesn't export. Unlike Stylelint, which falls back to the working directory and the global `node_modules`, a specifier resolves only from the folder of the config that names it, in npm and pnpm `node_modules` layouts. Configs load from JavaScript, TypeScript, JSON, YAML and extensionless files. Node loads a TypeScript config by stripping its types, so it can't use syntax that needs transforming, such as an `enum`, and its imports name files with their `.ts` extension. Node doesn't strip types under `node_modules`, so only a local TypeScript config loads, not one from a package. A loaded config file is evaluated once for each version of its content, so changes to the files it imports, or to the environment it reads, need a new process. Cycles and chains over 32 levels throw.

The final `ignoreFiles` list contains the globs of file types that are off, then extended configs' globs, then yours, keeping the last occurrence of each normalized glob. An override's `ignoreFiles` go last. A later negation can restore a file excluded earlier, and a later positive glob can exclude it again, so restoring a disabled file type also requires a suitable `customSyntax`.

Extended `referenceFiles` go before yours and Tailwind's. A config that two others extend contributes its lists once. `languageOptions` merge deeply, from the preset to extended configs to yours. Disable-report settings take the last extended config's value unless you set the option. Extended rules apply as [Rule merging][] describes, and Stylelint merges the extended plugins and overrides.

An extended config's override that matches a file replaces that config's `ignoreFiles`, `referenceFiles`, `languageOptions` and disable-report settings for the file, as in Stylelint, and a later extended config can replace them again. The preset then joins the result with its own lists and yours, as for the top level, and your overrides join theirs over it. An extended override's `referenceFiles` turn on the reference rules only for its files.

`defineConfig` rejects its promise with a `TypeError` for:

- Unknown options or wrong option types. `fix` throws anywhere, since a config's `fix` hides problems without writing the fixes, and so does a top-level `validate`, which the run's `validate` replaces; pass `--no-validate`, or set `validate` in an override.
- A missing or invalid `root`.
- An `extends` entry that can't be found or loaded, a cycle, or nesting over 32 levels.
- Invalid Tailwind function or at-rule names, or a `tailwindcss.entryPoint`, or one of its imports, that can't be read or parsed, or no `tailwindcss/theme.css` to resolve. See [Reference files][]. With `tailwindcss.validateApply`, an entry point that Tailwind fails to compile, as for a `@plugin` that doesn't resolve. See [tailwind-apply](#tailwind-apply).
- A `referenceFiles` entry none of whose paths and globs matches a file, at the top level, in an override or in an extended config, which Stylelint would fail on with a stack trace when it lints. Paths and globs are matched when the config loads, as Stylelint matches them: a symlink counts as what it links to, a folder's path stands for its files, dotfiles match only a glob that names the dot, and the entry's `!` globs apply. A glob that matches only through a symlinked folder, which Node's `fs.promises.glob` doesn't follow, is checked with a walk that follows each linked folder once for each way the glob can match below it and skips `node_modules` and dot folders unless the glob names one.
- Invalid globs in override `files`, `referenceFiles` or `ignoreFiles`, such as an empty or `!` glob in `files`, or globs too long or with too many braces. See [Overrides][].
- An override setting that would merge differently across the file types its globs match, when no glob can match just one type's files of it. See [Overrides][].

The error message names the option and what's wrong.

Stylelint validates rule settings when it lints. See [Replace a rule's setting][] for `replace()`'s checks.

### Rule merging

Your primary option replaces the preset's, secondary options merge over the preset's and `ignore*` lists add to them. A primary option that differs from the preset's drops the preset's `message`, `url`, `except` and `ignore`, which belong to its primary option: `'rule-empty-line-before': 'never'` loses the preset's `except: ['first-nested']`. An override that sets the preset's primary option again, over your top-level rule's, gets them back.

Settings apply in this order, each beating the ones before it: stylelint-config-standard and stylelint-config-recess-order; the preset's rules, with the Tailwind rules; the rules of the configs in your `extends`, where a later config beats an earlier one and a config's own rules beat those of the configs it extends; your `rules`, merged over all of that. `defineConfig` puts the preset's settings in a config of their own in the result's `extends`, after the base configs and before yours, as the static preset's are when you extend it, and the result's own `rules` are the ones you set, merged. An extended config's setting replaces the preset's whole setting, as in Stylelint, at the top level and in the preset's file type overrides, a `null` there included. That includes the preset's fix-safety settings in those overrides: `value-keyword-case`'s exceptions in CSS Modules for `composes` and camelCase names. Set such a rule in your `rules` instead to keep them. Your settings merge over it as they would over the preset's. Your top-level rules skip a rule that the preset's file type override turns off, such as `declaration-block-single-line-max-declarations` in Markdown, unless an extended config sets it. The reference rules that `referenceFiles` and `tailwindcss.entryPoint` turn on, at the top level or in an override, are the preset's settings too, so an extended config, its overrides and an override's own `extends` can change or turn them off. An extended config's own overrides apply over its top-level rules and the preset's, unless you set the rule. Your override's own `extends` configs set the rules for its files over the preset's and the extended configs' settings, such as stylelint-config-standard-scss's for `*.scss` files, but not over your top-level `rules`, which beat everything in `extends`, as in Stylelint. Its `rules` merge over theirs. A config in your `extends`, or in an override's, that sets `declaration-empty-line-before`, `custom-property-empty-line-before` or a stock [quote rule][Quote rules], `font-family-name-quotes`, `function-url-quotes` or `import-notation`, at its top level or in its overrides, sets the [own rule][Own rules] that replaces it.

The base configs the preset builds on, stylelint-config-standard, the stylelint-config-recommended it extends, and stylelint-config-recess-order, add no rules when your `extends` reach them, at any depth, at the top level or in an override, since the preset has applied them already with its changes. Under a shared config that extends stylelint-config-standard, the preset's and Tailwind's settings stay; the shared config's own rules, and those of other configs such as stylelint-config-clean-order, still beat the preset. A base config is known by the package of the file it loads from, so a package name and a path into the package both count; a config object imported from one doesn't. `defineConfig` gives Stylelint such a config without its rules.

An `undefined` primary option keeps the base's and changes only the secondary options. The base is the setting of the override's own `extends` configs when they set the rule, then your top-level setting when an override changes a rule you set at the top level, and otherwise the setting of an extended config or the preset; when the rule is off there, it stays off. A rule that no config sets has no primary option to keep, so `[undefined, { … }]` for it throws. `'order/properties-order': [undefined, { disableFix: false }]` turns the order fix back on, as [Fix the property order](#fix-the-property-order) describes.

### Overrides

An override's globs give the file type of its files, from their extensions: Astro, HTML, Markdown, CSS Modules for `.module.css`, or CSS for any other extension. A glob whose extension is a wildcard, such as `src/**` or `*.*`, can match every type, and a `.css` glob whose name has a wildcard, such as `src/*.css`, can match CSS Modules too. Globs support braces, and a brace of one item, as in `*.{astro}`, is literal text, as in Stylelint. Globs with a `/` resolve from `root`, in extended configs too. A glob without a `/`, such as `*.css` or `*.legacy.css`, stays as it is, as in the preset's own overrides for `.astro`, `.html`, Markdown and `.module.css` files: Stylelint matches it against each file's name, so it matches files at any depth, through any spelling of the path, and wherever a config that `defineConfig` builds in a shared preset package is extended from. Your other globs, and the `ignoreFiles` globs of the file types that are off, stay resolved from the `root` of the config that sets them, so a shared preset's `astro: false` ignores `.astro` files only under its own folder. Set `astro: false`, or an `ignoreFiles` glob, in the extending config too.

An override whose files are all of one type merges over that type's settings, and any other over the top-level ones. An override of several types, such as `files: ['src/**']` or `files: ['**/*.{astro,html}']`, merges over each type's settings for its files of that type, as one override per type would. An override of several types whose setting merges differently over each type's settings than over the top-level ones is split into one override per type, each merging over its type's settings, so `{ files: 'src/**', rules: { 'selector-pseudo-class-no-unknown': [true, { ignorePseudoClasses: ['deep'] }] } }` keeps `:global()` in `.astro` files and lints each file as the split overrides would. The split overrides' globs match exactly the files of their type: a glob whose extension names types, such as `**/*.{astro,html}`, gives `**/*.astro` and `**/*.html`, and one whose last segment is `**` or `*`, such as `src/**`, gives `src/**/*.astro`, `src/**/*.html`, `src/**/*.@(md|markdown)`, `src/**/*.module.css` and `src/**/!(*.@(astro|html|md|markdown)|*.module.css)` for every other extension. A `.css` glob whose name before `.css` can end in `.module`, such as `src/*.css` or `src/a*.css`, gives `src/*.module.css` and `src/!(*.module).css`, while one whose name can't, such as `src/*-theme.css`, matches only CSS files. Any other glob that can match several types, such as `src/a*`, `src/*e.css`, `src/*.*` or repeated alternatives like `src/*.+(astro|html)`, can't be split, so such an override throws when a setting merges differently, unless the setting is `null` or wrapped with `replace()`, which don't merge. The error suggests a glob per type, such as `src/a*.astro`, or `replace()`. `'declaration-block-single-line-max-declarations': 2` on `src/**` isn't split, though Markdown turns that rule off, since `2` replaces both settings alike.

Stylelint applies an override when any of its globs matches, so a `!` glob such as `!src/legacy/**` would match every other file. It throws: exclude files with `ignoreFiles`, or list positive globs. Globs over 4096 characters, braces nested over 10 deep and braces that expand to more than 1000 globs throw too, in `files`, `referenceFiles` and `ignoreFiles`, including extended configs. These bounds limit matching cost: deeply nested or long brace globs make Stylelint's matching slow.

Stylelint replaces the top-level `ignoreFiles`, `referenceFiles` and `languageOptions` with an override's, so the preset joins them:

- An override's `ignoreFiles` go after the top-level list.
- Its `referenceFiles` go after the top-level ones, which include Tailwind's files. Its own `referenceFiles` turn the reference rules on for its files, as the preset's settings, where the preset doesn't set them for those files, as the Markdown override does. An override of several file types, such as `src/**`, sets the Markdown override's settings back after it. Your rules and those of your `extends` configs beat these settings, as [Rule merging][] describes.
- Its `languageOptions` merge deeply into the top-level ones, which include the Tailwind CSS syntax.

### Reference files

`tailwindcss.entryPoint` is the Tailwind entry stylesheet: an absolute path, a path relative to `root`, or a `file:` URL or URL string, such as `import.meta.resolve('./src/styles/global.css')`. The reference files get the stylesheet, the files it imports, and the `theme.css` of the `tailwindcss` installed at or above its folder, for Tailwind's default theme variables. A namespace reset in an `@theme` block of the entry point or its imports, such as `--color-*: initial`, leaves that namespace's default variables out when it comes after the import of Tailwind's theme, as Tailwind does, and `--*: initial` leaves them all out; the names you declare again in your `@theme` still count. When the entry point doesn't import the theme, its resets all apply. With Tailwind on and no `entryPoint`, `referenceFiles`, at the top level or in an override, gets the `theme.css` installed at or above `root`. `NODE_PATH` isn't searched.

With an `entryPoint`, the internal properties that Tailwind's utilities register with `@property`, such as `--tw-shadow`, `--tw-ring-offset-shadow` and `--tw-translate-x`, count as known too. Their names come from the `compile()` of that `tailwindcss`, run once per process when the config loads, which adds about 20 ms. Other `--tw-*` names are reported.

The entry point's `@import` and `@reference` targets are followed recursively, up to 32 levels deep, and resolve as Tailwind resolves them: `./components` names `components.css` or `components/index.css`, and a path without `./` names a file next to the importing file first. Otherwise it's a package import, such as `tw-animate-css` or `@acme/ui/theme.css`, resolved from the `node_modules` folders at or above the importing file through the `style` condition of the package's `exports`, or else its `style` field, then its `index.css`. Only imports that resolve to a `.css` file, and whose real path, through any symlink, ends in `.css` too, are followed, so a stylesheet, a package's included, can't make a `.env` or another non-CSS file a reference file. A relative import that names no file, such as a missing `./tokens` or a folder without an `index.css`, throws, as in Tailwind. Packages that aren't installed, `tailwindcss` itself, whose theme comes from its `theme.css`, and absolute and `http(s):` URLs aren't followed either. Each followed file is parsed when the config loads, and one that doesn't parse throws an error naming it, its importer and the position, without its content. Conditional imports, such as those with `supports()` or a media query, are followed anyway. Each file is listed once, even when reached through a symlink or another import.

With a theme prefix, as in `@import 'tailwindcss' prefix(tw)` or `@theme prefix(tw)`, the reference files name theme variables with the prefix, as Tailwind does: `var(--tw-color-red-500)` is known and `var(--color-red-500)` is reported. An `@import`'s `prefix()` applies to the `@theme` blocks of the files it imports. Custom properties outside `@theme` blocks, and files that only `referenceFiles` lists, keep their names. A linted file's own declarations count by the names it writes, so in the entry point itself, under `prefix(tw)`, `var(--color-brand)` for its own `@theme`'s `--color-brand` isn't reported, though Tailwind names the variable `--tw-color-brand`.

The rules check each `<style>` block and `style` attribute of an `.astro` or `.html` file on its own, so a custom property set in one and used in another, such as an Astro `<style define:vars={{ progress }}>` used as `var(--progress)`, is reported. [Fix unknown custom property reports][] shows how to declare such properties and the ones set at runtime.

Stylelint reads and parses the reference files, Tailwind's `theme.css` and the entry point's imports included, again for every file it lints, which adds about 1 ms a file.

Stylelint's `--cache` doesn't track the reference files: after renaming a custom property in one, a cached file that uses the old name still passes. Delete the cache file, `.stylelintcache` by default, or run without `--cache` after changing a reference file. The entry point's imports are read when the config loads, so a long-running process, such as an editor's Stylelint extension, follows an `@import` added later only after it restarts.

### Rule changes

| Rule | Change from `stylelint-config-standard` |
| --- | --- |
| `order/properties-order` | Recess order, reported but not fixed |
| `property-no-vendor-prefix`, `value-no-vendor-prefix` | Reported but not fixed |
| `font-family-name-quotes`, `function-url-quotes`, `import-notation` | Off, replaced by the [quote rules][Quote rules], which require quotes and take your settings of them. Fixed everywhere but in `style` attributes, where Prettier then sets the quote style. A disable comment can name either rule |
| `selector-no-deprecated` | On, reported but not fixed |
| `plugin/use-baseline` | Warns about features that aren't Baseline newly available, except `user-select`, whose prefixed form `property-no-vendor-prefix` reports. See [Change the Baseline target][] |
| `function-no-unknown` | On, allowing `tech()` |
| `color-no-invalid-hex`, `unit-no-unknown` | On. In an ordinary declaration, `declaration-property-value-no-unknown` reports the same invalid hex color or unknown unit, so it's reported twice. They stay on since they also check what that rule skips: custom properties, at-rule preludes, and values with `var()` or an untyped Tailwind function such as `theme()` |
| `function-linear-gradient-no-nonstandard-direction` | On |
| `selector-no-invalid`, `selector-no-unmatchable`, `function-url-no-scheme-relative` | On |
| `display-notation` | `short` |
| `number-max-precision` | 6 |
| `font-weight-notation` | `numeric`, as Tailwind's theme writes weights, fixing `bold` to `700`. `bolder` and `lighter` stay |
| `value-keyword-case` | Keeps the case of font names in `--font-*` properties, and in `*.module.css` files of `composes` values and of camelCase names, such as `darkMode` in an `:export` block or a `@value` name. CSS keywords written in camelCase, such as `currentColor`, are still lowercased |
| `no-descending-specificity`, `comment-empty-line-before` | Off |
| `no-unknown-custom-properties`, `no-unknown-custom-media`, `no-unknown-animations` | On with `referenceFiles` or `tailwindcss.entryPoint`, and in an override with its own `referenceFiles`, as is [`@gpahal/tailwind-theme-function`](#tailwind-theme-function) with `tailwindcss` on. Off in Markdown, whose code blocks can be snippets |
| `selector-pseudo-class-no-unknown` | Allows `:global()` in `.astro` files |
| CSS Modules | In `*.module.css` files, allows `:global`, `:local`, `:export` and `:import`, the `composes` property and the properties of `:export` and `:import` blocks, `@value`, and camelCase class names. `value-keyword-case` doesn't lowercase the class names of `composes` or camelCase names, such as `:export` and `:import` values and `@value` references, which its fix would break, but still lowercases CSS keywords such as `currentColor`. `declaration-property-value-no-unknown` doesn't know `@value` names, so a value that uses one, such as `color: primary`, is reported |
| `declaration-empty-line-before` | Off, replaced by [`@gpahal/declaration-empty-line-before`][declaration-empty-line-before], which takes your setting of it. A disable comment can name either rule |
| `custom-property-empty-line-before` | Off, replaced by [`@gpahal/custom-property-empty-line-before`][custom-property-empty-line-before], which takes your setting of it. A disable comment can name either rule |

`declaration-property-value-no-unknown` reports `sibling-index()` and `sibling-count()` as a whole value, as in `z-index: sibling-index()`, since the CSS syntax data it reads, css-tree's, doesn't know them yet. Inside `calc()` they pass. Use a disable comment until css-tree adds them.

In Markdown, code blocks can be partial snippets, and one-line blocks are allowed in the HTML; ` ```vue ` and ` ```svelte ` code blocks aren't linted.

Code blocks and `<style>` blocks in another style language, such as ` ```scss ` or `<style lang="scss">`, aren't linted, in `.astro`, `.html` and Markdown files alike, whether or not a syntax such as `postcss-scss` is installed. Neither are code blocks fenced with `~~~`.

`.vue`, `.svelte`, `.scss`, `.less`, `.htm`, `.mdx` and CSS-in-JS files aren't supported. Leave them out of the files you pass Stylelint, or give them a syntax with an override, as [Lint SCSS files][] does.

After `stylelint --fix`, Stylelint's summary still counts the problems of the report-only rules above as fixable with `--fix`: its formatter reads whether a rule can fix, not the preset's `disableFix`.

### Tailwind CSS changes

| Change | Detail |
| --- | --- |
| At-rules | `@theme`, `@source`, `@utility`, `@variant`, `@custom-variant`, `@apply`, `@plugin`, `@config`, `@reference` and `@tailwind utilities` are declared. The preludes of `@theme`, `@source`, `@plugin`, `@config`, `@reference` and `@tailwind` have a syntax, so a typo in them is reported; the names of `@utility`, `@variant` and `@custom-variant`, and the classes of `@apply`, take any value, and [`@gpahal/tailwind-directives`](#tailwind-directives) checks their structure. `@import` accepts Tailwind's options, which aren't checked: Stylelint reads any function there, such as a misspelled `prefx(tw)`, as a media condition, and a bare word, such as a misspelled `importnt`, as a media type, so neither is reported |
| Functions | `--alpha()` is checked. A value with `theme()`, `--theme()`, `--spacing()` or an added function isn't, except for the variables of `theme()` and `--theme()`, which [`@gpahal/tailwind-theme-function`](#tailwind-theme-function) checks with reference files |
| Theme variables | Names such as `--text-tiny--line-height`, `--color-gray-0\.5` and `--color-*` are allowed |
| `alpha-value-notation` | `number` |
| `hue-degree-notation` | `number`, as Tailwind's palette writes hues, such as `oklch(97.1% 0.013 17.38)`, where the default config wants `17.38deg` |
| `custom-property-empty-line-before`, `@gpahal/custom-property-empty-line-before`, `custom-property-no-missing-var-function` | Off |
| `at-rule-empty-line-before` | `@apply` can follow a declaration, blockless at-rules group with or without blank lines between them, and `@import`, `@plugin`, `@source`, `@config` and `@reference`, including a `@plugin` with an options block, are exempt everywhere, so an entry file groups them with or without blank lines and one needs no blank line after a rule either |
| `@gpahal/declaration-empty-line-before` | A declaration can follow an `@apply` without an empty line |
| [`@gpahal/tailwind-directives`](#tailwind-directives) | On |
| [`@gpahal/tailwind-theme-function`](#tailwind-theme-function) | On with reference files |
| [`@gpahal/tailwind-apply`](#tailwind-apply) | On with `tailwindcss.validateApply` |

A clean lint doesn't prove the compiled CSS is valid. Lint Tailwind's output too for that.

### Own rules

`@gpahal/comment-layout`, `@gpahal/media-range-spacing` and the Tailwind CSS rules take `true` to enable them and `null` to disable them. Stylelint reports any other primary option as a configuration error.

The own rules that replace stock rules, [declaration-empty-line-before][], [custom-property-empty-line-before][] and the [quote rules][Quote rules], take the stock rule's options. With `defineConfig`, configure each through the stock rule's name. Under `extends`, setting the stock rule to options runs the stock rule in place of the own rule. Setting it to `null` there leaves the check on, since Stylelint can't tell your `null` from the preset's; to turn the check off, set the own rule to `null`. A disable comment can name the stock rule or the own rule, but `stylelint-enable` of the stock rule inside a `/* stylelint-disable */` block doesn't turn the own rule back on.

#### comment-layout

`@gpahal/comment-layout` lays out a multi-line comment JSDoc-style, with `/*` and ` */` on their own lines and `*` before each line between. Its fix also rewrites a `/**` opening to `/*`. It leaves alone a comment with code on its lines, a `/*!` legal comment, a directive such as `stylelint-disable` (or one with the `configurationComment` prefix), and a banner, whose first or last line is one of `*`, `=`, `-`, `#` or `~` repeated at least 3 times, as in `/*****` or `=== */`, or is only `*`, as in `/***` or `***/`. It also leaves alone a comment that holds CSS code, whose text parses as CSS with a rule, a block or a final `;`, so commented-out CSS can be uncommented as is, while prose such as `Note: keep in sync` is still laid out. It reports without a fix a comment whose stars it can't read: some lines start with `*` and some don't, a line starts with a `*` that is text, as in `*.css`, `*Important*` or `/**Note**`, or the first line has text and every line after it starts with `*`, which could be star prefixes or list bullets. The `commentLayout` option turns it off.

#### media-range-spacing

`@gpahal/media-range-spacing` puts one space on each side of a media query range operator: `(width>=640px)` becomes `(width >= 640px)`. It checks the preludes of `@media`, `@container`, `@custom-media` and `@import`, and the queries of Tailwind's `@custom-variant` shorthand. It reports an at-rule once, at its first unspaced comparison, so a disable comment for that line covers the whole at-rule. It skips an at-rule with a comment inside its prelude, such as `@media (width>1px) /* Wide */ and (height>1px)`, since its fix would drop the comment.

#### tailwind-directives

`@gpahal/tailwind-directives`, on with `tailwindcss`, reports the structural mistakes in Tailwind CSS v4's at-rules and functions that fail Tailwind's build but that Stylelint's syntax checks pass, mirroring the checks of Tailwind 4.3's `compile()`:

- An empty prelude of `@source`, `@plugin`, `@variant`, `@apply`, `@custom-variant`, `@utility`, `@reference` or `@config`, such as `@plugin;` or `.a { @apply; }`. Tailwind skips an empty `@reference`, which then does nothing.
- A `@utility`, `@custom-variant`, `@source`, `@plugin` or `@config` that isn't at the root, such as in `@media` or `@layer`, or a `@utility` in another.
- A `@utility` name that Tailwind rejects, such as `Foo-Bar`, `foo-` or `foo-*-bar`, and a `@utility` without a block.
- A `@custom-variant` name that Tailwind rejects, such as `Foo`, and a `@custom-variant` with both a selector and a body, with neither, or with an empty selector, as in `(&:hover, )`.
- An empty variant in a `@variant`, as in `@variant hover:` or `@variant , hover`.
- A bare `--value()` or `--modifier()` argument in a `@utility` other than `number`, `integer`, `ratio` and `percentage`, such as `--value(integr)`, which Tailwind ignores with a warning. A `[type]`, a `--namespace-*` and a quoted value aren't checked.
- A `--alpha()` without a color and an alpha value, as in `--alpha(var(--c) / )`, or with a second argument. `declaration-property-value-no-unknown` reports these in a value without `var()` or an untyped Tailwind function, one of `tailwindcss.functions` other than `--alpha`, such as `theme()`, so this rule checks only the values that it skips. The preset gives the rule those functions as its `untypedFunctions` option.

It doesn't check whether a utility, variant or class exists; see [tailwind-apply](#tailwind-apply).

#### tailwind-theme-function

`@gpahal/tailwind-theme-function`, on with `tailwindcss` and reference files, reports a `theme()` or `--theme()` call whose variable isn't a theme variable, which fails Tailwind's build, as in `theme(--color-nope)`. It checks the calls in declaration values and in `@media`, `@custom-media`, `@container` and `@supports` preludes, where Tailwind evaluates them. A theme variable is one declared in an `@theme` block of the file or of the reference files, Tailwind's `theme.css` included; a custom property outside `@theme`, such as in `:root`, isn't one, as in Tailwind. As in Tailwind, an `initial` value, such as `--color-brand: initial`, or a namespace reset, such as `--color-*: initial`, removes the variables declared before it in its file, and in the linted file it also removes the reference files' variables, unless the linted file is a reference file itself, whose place among them isn't known. Under a theme prefix, the variable is named without the prefix, as in Tailwind: `theme(--color-red-500)`, not `theme(--tw-color-red-500)`. A call with a fallback argument, such as `theme(--brand, red)`, isn't checked, nor is the opacity modifier after a `/`. A legacy key path, such as `theme(colors.red.500)`, is checked as the variable it maps to, `--color-red-500`, when its first key is one of Tailwind's own mapped keys, such as `colors`, `fontSize` or `screens`; other paths, and paths with brackets, aren't checked. No call is checked when a file has a `@config` or `@plugin`, whose JavaScript can add theme keys, which Tailwind turns into theme variables, as `colors.brand` into `--color-brand`. It's off in Markdown, as the reference rules are.

#### tailwind-apply

`@gpahal/tailwind-apply`, on with `tailwindcss: { validateApply: true }`, reports a class of an `@apply` or a variant of a `@variant` that Tailwind CSS doesn't know, which fails Tailwind's build, as in `@apply flex nope` or `@variant nope`:

```js
// stylelint.config.mjs
import { defineConfig } from '@gpahal/stylelint-config'

export default defineConfig({
  root: import.meta.dirname,
  tailwindcss: { entryPoint: 'src/styles/global.css', validateApply: true },
})
```

The classes and variants are those of the design system that Tailwind's `compile()` gives for the entry point: Tailwind's own, and the `@utility`, `@custom-variant`, `@theme`, `@plugin` and `@config` of the entry point and the files it imports, without their other rules, so an `@apply` or `theme()` error in them doesn't stop it. Without an `entryPoint`, they're those of Tailwind's default theme, from the `tailwindcss` installed at or above `root`. Under a theme prefix, classes take it, as in `@apply tw:flex`, as in Tailwind. A root `@variant` without a block, a `@custom-variant` shorthand, isn't checked. Comments in an `@apply` are skipped, as in Tailwind. It's off in Markdown, as the reference rules are.

The files load as in Tailwind's own build. Imports resolve as for the [Reference files][], from the real path of a symlinked file, and an absolute path is loaded too; a scheme-relative URL, such as `//cdn.example.com/a.css`, loads nothing. An import that isn't a `.css` file, by its name or its real path, loads as empty, so a `.env` isn't read. A relative or absolute `@plugin` or `@config` path names a file as it is or with `.js`, `.json`, `.node` or `.ts` added, or a folder's `index` with them, and a package resolves through the `node` and `import` conditions of its `exports`, or else its `module` or `main` field, then through `node` and `require`.

Off by default, since it compiles the entry point when the config loads, running the JavaScript of its `@plugin` and `@config` files, and since a class can come from elsewhere, such as a stylesheet that the entry point doesn't import. Tailwind builds each distinct class once to check it, at a cost that grows with the classes before it, so each design system checks at most 2,000 distinct classes and variants, and reports none after them. Both are cached for the life of the process, until a stylesheet that the compile read changes. `defineConfig` throws when Tailwind fails to compile the entry point, as for a `@plugin` that doesn't resolve.

#### declaration-empty-line-before

`@gpahal/declaration-empty-line-before` is the stock rule with its options, except that it skips `style` attributes and allows a declaration immediately after Tailwind's `@apply`. In a `style` attribute that Prettier wrapped onto lines, the stock rule asks for an empty line before a declaration after a custom property, as in `--progress: 50%; color: red`, and its fix writes one into the attribute.

#### custom-property-empty-line-before

`@gpahal/custom-property-empty-line-before` is the stock rule with its options, except that it skips `style` attributes, where the stock rule asks for an empty line before the first custom property, as in `style="--progress: 50%"`, and its fix writes one into the attribute.

#### Quote rules

`@gpahal/font-family-name-quotes`, `@gpahal/function-url-quotes` and `@gpahal/import-notation` are the stock rules with their options, which they validate under their own names, except that in a `style` attribute they report without fixing. Their fixes write double quotes, which would end a double-quoted attribute early, so one setting of a stock rule couldn't fix the `<style>` blocks of `.astro`, `.html` and Markdown files and leave the attributes alone. The preset sets them to `always-unless-keyword`, `always` and `string`.

[Change a rule's options]: #change-a-rules-options
[Change the Baseline target]: #change-the-baseline-target
[Check custom properties]: #check-custom-properties
[Fix unknown custom property reports]: #fix-unknown-custom-property-reports
[Lint SCSS files]: #lint-scss-files
[Options]: #options
[Overrides]: #overrides
[Own rules]: #own-rules
[Quote rules]: #quote-rules
[Reference files]: #reference-files
[Replace a rule's setting]: #replace-a-rules-setting
[Rule changes]: #rule-changes
[Rule merging]: #rule-merging
[Set a rule for one file type]: #set-a-rule-for-one-file-type
[Tailwind CSS changes]: #tailwind-css-changes
[Tailwind CSS v4]: #tailwind-css-v4
[custom-property-empty-line-before]: #custom-property-empty-line-before
[declaration-empty-line-before]: #declaration-empty-line-before
