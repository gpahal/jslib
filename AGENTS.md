# jslib

Run commands from the repository root. [README.md](README.md) has setup and the packages' configuration contracts.

## Workflow

- Packages and the root lint and format configs load `build/` output, so run `pnpm build` before a direct package test or typecheck and after changing a preset.
- Run `pnpm lint-fix`, `pnpm fmt`, then `pnpm check`, the final gate, since `pnpm lint`'s cache can miss cross-file type changes.
- Before opening a pull request, stage your changes and run `pnpm verify-changesets`, which CI also runs, and add changesets until it passes. It lists each published package whose shipped files changed or that bundles changed `@gpahal/internal` source. Write a changeset by hand as `.changeset/<slug>.md`: a `'@gpahal/<name>': patch` line between `---` lines for each listed package, then a sentence for the changelog. When it asks for a changeset but lists no package, as for a test-only change, write an empty one, with nothing between the `---` lines.
- Only the Version and Publish workflows version and publish packages, and releases get no git tags.

## Changes

- Every top-level `src/*.ts` is public. Put private modules in `src/internal/`. A `src/cli.ts` with a shebang becomes the `bin`. Build regenerates `package.json` exports; include those changes.
- Import a package's own modules with `@/`. Import workspace packages from root files by path; root workspace dependencies broaden every Turbo task's hash.
- When a task reads a shared root file, add it to that task's `inputs` in [turbo.json](turbo.json). Use `globalDependencies` only when every task reads it.
- Public optional options use `?: T | undefined` for consumers with `exactOptionalPropertyTypes`.
- Put generic helpers used by multiple packages in std. Configs need independent copies of shared rule values; use `clonePlain`.
- Put shared code that isn't for publishing in [`@gpahal/internal`](packages/internal/README.md), such as `@gpahal/internal/comments` for block comments. Use `runNode` from its `node/testing` to run Node without pnpm's `NODE_PATH`.
- Validate options with `assertValid` from `@gpahal/internal/node/zod` and the schemas of `@gpahal/internal/node/options`. When changing list options or merge behavior, update [Lists and merging](README.md#lists-and-merging).
- Support npm's and pnpm's `node_modules` layouts only.
- When adding a dependency with build scripts, review `allowBuilds` in [pnpm-workspace.yaml](pnpm-workspace.yaml). A dependency loaded by resolved path needs a reasoned `ignoreDependencies` entry in [knip.jsonc][].

## Errors

- Build every thrown message with `formatMessage`, or `formatMessageList` for several issues, from `@gpahal/std/errors`, in the shape `<package>: <subject>: <description>`. Keep a caught error as the `cause`.
- Subjects chain outer to inner: a backticked name or path (`` `typescript.rules` ``, `` `overrides[0].files` ``), or a short noun phrase (`options`, `config 2`, `font <url>`).
- The description starts lowercase and has no final period. A wrong value reads `expected <what>, received <describeValue(value)>`. A fix follows as a capitalized sentence after `. `.

## Tests and docs

- Keep comments for contracts, constraints and rationale. Docs describe current behavior.
- Keep Markdown paragraphs unwrapped, and add a linked table of contents to READMEs over about 100 lines.
- The root README's [setup recipes](README.md#setup-recipes) run as tests in [`packages/recipes`](packages/recipes/README.md), outside `pnpm test`; run them with `pnpm turbo run test-recipes`. Start every recipe file block with its file-name comment.
- Each std module needs an input contract in its header. Its README and JSDoc examples run as tests, so keep them self-contained.
- Tests must pass under the CPU contention of `pnpm check`: keep the default timeouts, assert on CPU time with `minCpuMs`, and wait on an event rather than a fixed delay, unless the code gives none.
- A child process that doesn't test a core area's rules or loading turns them off with `CORE_AREAS_OFF` from eslint-config's `tests/helpers.ts`.
- eslint-config and stylelint-config tests share modules within a worker. Add a test file that uses `vi.mock`, sets typescript-eslint's project service options in-process, or expects a once-per-process warning to the isolated files in that package's `vitest.config.ts`.
- An upstream workaround needs a canary in `tests/**/*.canary.test.ts` that fails when upstream fixes the bug and names what to remove. Only CI runs canaries; run them with `pnpm turbo run test-canaries`.

## Config packages

After changing ESLint configs, rules or plugins:

1. Run `pnpm --filter @gpahal/eslint-config gen`.
2. Run `pnpm --filter @gpahal/eslint-config test --update=all tests/inventory.test.ts tests/fix-output.test.ts`.
3. Review the generated types and snapshot diffs. Fixed TypeScript fixtures must still compile.

Register overlapping ESLint rules in [duplicate-rules.ts](packages/eslint-config/src/internal/duplicate-rules.ts). Add user-config validation to `checkUserConfig` in [user-configs.ts](packages/eslint-config/src/internal/user-configs.ts) so every composer method uses it. Patched rules keep their names so disable comments work.

After changing Stylelint rules, run `pnpm --filter @gpahal/stylelint-config test --update=all tests/inventory.test.ts` and review the diff. An own rule that replaces a stock rule honors disable comments that name the stock rule and takes the user's setting of it.

## New packages

Copy a similar package's manifest, scripts and tsconfigs, and run `ln -s ../../LICENSE LICENSE` in it. Add it to `workspaces` in [knip.jsonc][], and to `browser.files` in [eslint.config.mjs](eslint.config.mjs) when it's browser-safe. Add a README with installation and usage, linked from the root README.

[knip.jsonc]: knip.jsonc
