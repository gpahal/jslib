# jslib

Run commands from the repository root. Read [README.md](README.md) for setup, package links and configuration contracts.

## Workflow

- Build before direct package tests or typechecks: packages and the root lint and format configs load `build/` output, so rebuild changed presets before using them.
- Run `pnpm lint-fix`, `pnpm fmt`, then `pnpm check`, the final gate. `pnpm lint`'s cache can miss cross-file type changes.
- The owner publishes; see [Releasing](README.md#releasing). Every change that users of a package can see needs a changeset, and a change to `@gpahal/internal` needs one for each package that bundles it.
- Write each changeset by hand as `.changeset/<slug>.md`: front matter with one `'@gpahal/<name>': patch` line per package between `---` lines, then a sentence on what changed for the releaser; no changelog is written. Don't run `pnpm cs`, which bumps versions.
- The pre-push hook pushes only `HEAD`, fails on any untracked or uncommitted file and runs `pnpm check`, so remove scratch files before pushing.

## Changes

- Every top-level `src/*.ts` is public. `src/cli.ts` is never exported; give it a shebang to make it the `bin`. Put private modules in `src/internal/`. Build regenerates `package.json` exports; include those changes.
- Import a package's own modules with `@/`. Import workspace packages from root files by path; root workspace dependencies broaden every Turbo task's hash.
- When a task reads a shared root file, add it to that task's `inputs` in [turbo.json](turbo.json), as with `eslint.config.mjs` and `package.json` for `lint-check`. Use `globalDependencies` only when every task reads it.
- Public optional options use `?: T | undefined` for consumers with `exactOptionalPropertyTypes`.
- ESLint's and Stylelint's `defineConfig` require `root`; relative option paths and globs resolve from it. Prettier's takes an optional `root`, which covers only `tailwindcss.entryPoint`, dot-prefixed plugin paths and bare plugin names, falling back to a name as given; without it, Prettier resolves dot-prefixed plugin paths from the config file's folder and bare names from the working directory, and the Tailwind plugin resolves the entry point from the folder of the config file found from the formatted file, not one given with `--config`. Override globs resolve from the config file's folder either way, and raw plugin options keep their native behavior.
- Put generic helpers used by multiple packages in std, with docs and tests. Configs need independent copies of shared rule values; use `clonePlain`. Use `@gpahal/internal/comments` for block comments.
- When changing list options or merge behavior, consult and update [Lists and merging](README.md#lists-and-merging). Validate options with `assertValid` from `@gpahal/internal/node/zod` and the schemas and resolvers of `@gpahal/internal/node/options`.
- Put shared code that isn't for publishing in [`@gpahal/internal`](packages/internal/README.md), as a dev dependency; tsdown bundles it into each package that imports it. Its modules in `src/` stay browser-safe; Node-only ones go in `src/node/`, imported as `@gpahal/internal/node/<name>`. Shared test helpers are in `@gpahal/internal/node/testing`; use `runNode` to run Node without pnpm's `NODE_PATH`.
- Support npm's and pnpm's `node_modules` layouts. Don't add Yarn Plug'n'Play handling.
- When adding dependencies with build scripts, review `allowBuilds` in [pnpm-workspace.yaml](pnpm-workspace.yaml). Dependencies loaded by resolved path need a reasoned `ignoreDependencies` entry in [knip.jsonc][].

## Errors

- Every thrown message has the shape `<package>: <subject>: <description>`; build it with `formatMessage`, or `formatMessageList` for several issues, from `@gpahal/std/errors`.
- Subjects chain outer to inner: a backticked name or path (`` `typescript.rules` ``, `` `overrides[0].files` ``), or a short noun phrase (`options`, `config 2`, `font <url>`).
- The description starts lowercase and has no final period. A wrong value reads `expected <what>, received <describeValue(value)>`; anything else states what's wrong. A fix follows as a capitalized sentence after `. `.
- Keep a caught error as the `cause`.

## Tests and docs

- Keep comments for contracts, constraints and rationale. Use `/**` for declaration and member comments, `//` elsewhere. An `eslint-disable` needs a reason after `--`.
- Describe current behavior. Keep Markdown paragraphs unwrapped and add a linked table of contents to READMEs over about 100 lines.
- The root README's [setup recipes](README.md#setup-recipes) run in stylelint-config's `tests/setup-recipes.test.ts`, which writes each block under its first-line file-name comment into a pnpm-style project, runs the fixers, then the check with Stylelint at `--max-warnings 0`. It runs as the package's `test-recipes` task, which `pnpm check` runs and `pnpm test` leaves out; run it alone with `pnpm turbo run test-recipes`. Keep that comment on every recipe file block.
- Each std module needs an input contract in its header. Its README examples run through [readme.test.ts](packages/std/tests/readme.test.ts); use the supported literal/error result comments. JSDoc examples must be self-contained and compile against the public declarations.
- Tests must pass under the CPU contention of `pnpm check`. Don't give a test or hook its own timeout; the root `vitest.config.ts` limit only stops hangs. Assert on counted work with `countWork`, or on CPU time with `minCpuMs`, never on wall-clock time. Wait on an event rather than a fixed delay, unless the code gives none.
- A child process that doesn't test a core area's rules or loading turns them off with `CORE_AREAS_OFF` from eslint-config's `tests/helpers.ts`, which loads the config about four times as fast.
- An upstream workaround needs a canary that fails when the bug is fixed and names what to remove, like the existing `tests/upstream*.test.ts` and `tests/markdown-forks.test.ts`.

## Config packages

After changing ESLint configs, rules or plugins:

1. Run `pnpm --filter @gpahal/eslint-config gen`.
2. Build, then run `pnpm --filter @gpahal/eslint-config test --update=all tests/inventory.test.ts tests/fix-output.test.ts`.
3. Review generated types and snapshot diffs. Fixed TypeScript fixtures must still compile.

Register overlapping ESLint rules in [duplicate-rules.ts](packages/eslint-config/src/internal/duplicate-rules.ts). Add user-config validation to `checkUserConfig` in [user-configs.ts](packages/eslint-config/src/internal/user-configs.ts) so every composer method uses it. Patched rules keep their names so disable comments work.

After changing Stylelint rules, run `pnpm --filter @gpahal/stylelint-config test --update=all tests/inventory.test.ts` and review the diff. Stylelint plugin rules need a `/` and can't replace a built-in, so an own rule that replaces a stock rule honors disable comments that name the stock rule, and `defineConfig` gives it your setting of the stock rule.

## New packages

Copy a similar package's manifest, scripts and tsconfigs; test scripts pass `--config ../../vitest.config.ts`. Run `ln -s ../../LICENSE LICENSE` in the package. Add it to `workspaces` in [knip.jsonc][], and to `browser.files` in [eslint.config.mjs][] when it's browser-safe. Add a README with installation and usage, linked from the root README.

[eslint.config.mjs]: eslint.config.mjs
[knip.jsonc]: knip.jsonc
