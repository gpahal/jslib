# Implementation plan: simplify internals, fix confirmed bugs, thin the test layer

This plan is the complete brief for an independent agent. It was settled with the owner over a review and a bug hunt; every decision below is final unless marked as conditional. Work through it to done without check-ins, following the rules in [Ground rules](#ground-rules).

## Contents

- [Goal](#goal)
- [Ground rules](#ground-rules)
- [Git and worktree workflow](#git-and-worktree-workflow)
- [Orchestration and phases](#orchestration-and-phases)
- [Phase 0: setup and baseline](#phase-0-setup-and-baseline)
- [Phase 1, stream A: tooling and test infrastructure](#phase-1-stream-a-tooling-and-test-infrastructure)
- [Phase 1, stream B: eslint-config source](#phase-1-stream-b-eslint-config-source)
- [Phase 1, stream C: stylelint-config](#phase-1-stream-c-stylelint-config)
- [Phase 1, stream D: internal, prettier-config, std, font-fallback](#phase-1-stream-d-internal-prettier-config-std-font-fallback)
- [Phase 2, stream E: eslint-config test trims](#phase-2-stream-e-eslint-config-test-trims)
- [Phase 2, stream F: cross-package consolidation](#phase-2-stream-f-cross-package-consolidation)
- [Phase 3: top-level type imports](#phase-3-top-level-type-imports)
- [Phase 4: final verification and report](#phase-4-final-verification-and-report)
- [Out of scope](#out-of-scope)
- [Status](#status)

## Goal

Make the internals of the `@gpahal/*` packages thinner, simpler and faster, fix the confirmed bugs, and slim the test and tooling layer, while the public API stays as easy to use as it is now. Error messages, warnings and editor UX must stay at least as good as today.

"Same results" is the default for every item: identical lint and format results, identical options and rules, and the same inputs throw or don't throw. Error and warning text may change only to become clearer or more consistent, and every text change is listed in the final report. The only intended behavior changes are the bug fixes and the owner-approved picks named in this plan, each marked **Behavior change**.

## Ground rules

- Read [AGENTS.md](AGENTS.md) and [README.md](README.md) before starting. Their rules apply in full: error message shape via `formatMessage`/`formatMessageList`, `?: T | undefined` options, `@/` imports, `clonePlain` for shared rule values, comments policy, unwrapped Markdown paragraphs, std module header contracts, the config-package procedures after ESLint or Stylelint rule changes, `allowBuilds` and knip `ignoreDependencies` reviews when dependencies change, and the new-package checklist.
- **No changesets, in any phase or stream.** The owner writes them later. Do not add `.changeset/*.md` files, even though AGENTS.md asks for them, and do not run `pnpm cs` or `changeset`. Instead, the final report lists every user-visible change per package so the owner can write them.
- **Temporary files:** keep scratch scripts, fixtures and repros in a fresh `mktemp -d` folder outside the repo, or in a package's gitignored `tests/tmp/`. Never commit them, and track every path you create so Phase 4 can delete it.
- **Never weaken, skip or delete a test to make it pass.** A test that fails after a change means the change is wrong or the test pins a bug being fixed here; in the second case update it and say so in the report. The test trims in this plan are approved for redundancy and speed only; for each removed test, record in the report what it covered and where that coverage now lives (or that it is dropped, as approved).
- **Dependencies:** the only approved additions are `semver` as a runtime dependency of `@gpahal/prettier-config` (item F2), and `import-meta-resolve` for packages that bundle the replaced resolver, only if item D2's parity condition holds. Moving existing dev dependencies into the new private `packages/recipes` (item A5) is approved. Any other new dependency, tool or `.env` access: don't; record it as a follow-up.
- **Every bug fix gets a regression test** that fails before the fix and passes after it. Each test uses the smallest input that shows the bug.
- **Commit, but don't push or open a PR.** Pushing, PRs and merging to `main` are the owner's call.
- **Latitude:** while working you may make other behavior-preserving simplifications under about 50 lines each, only inside files your stream already touches. List each one in the report. Bigger ideas go to the report's "Proposed follow-ups".
- **When an item turns out wrong** (the claim doesn't hold, the fix would change intended behavior beyond what is approved, or it needs changes far outside its scope), skip it, record why in [Status](#status) and the report, and continue. Line numbers in this plan come from review agents and may be off by a few lines; verify every claim against the code before acting on it.
- **The final gate after every merge into the integration branch:** `pnpm lint-fix`, `pnpm fmt`, then `pnpm check`, all green. After Phase 1 item A1 lands, `pnpm check` no longer runs canaries; also run `pnpm turbo run test-canaries` before each merge that touches upstream workarounds, and at the end.
- **Build before direct package tests or typechecks:** packages and the root lint and format configs load `build/` output. After changing ESLint configs, rules or plugins: run `pnpm --filter @gpahal/eslint-config gen`, build, then `pnpm --filter @gpahal/eslint-config test --update=all tests/inventory.test.ts tests/fix-output.test.ts`, and review the snapshot diff line by line. Fixed TypeScript fixtures must still compile. After changing Stylelint rules: `pnpm --filter @gpahal/stylelint-config test --update=all tests/inventory.test.ts` and review the diff.

## Git and worktree workflow

- **Integration branch:** `refactor/simplify-internals`. It is checked out in the worktree `/home/gpahal/.t3/worktrees/jslib/t3-3d66a753`, and its base is `main` at `24b109e`. The parent agent works there. The first commit on it is this plan file.
- **Stream branches:** each stream runs in its own worktree on a branch named `simplify-internals-<stream>`, for example `simplify-internals-a-tooling`. Create it from the current integration head with `git wt add simplify-internals-<stream> refactor/simplify-internals`, which prints the worktree path, or with your harness's own worktree feature. In a new worktree, run `pnpm install --frozen-lockfile` and `pnpm build` before anything else.
- **Sub-worktrees:** a stream agent may split its work further into its own sub-worktrees, branched from its stream branch. It squash-merges them back into its stream branch the same way.
- **Merging back:** in the integration worktree, run `git merge --squash simplify-internals-<stream>`, resolve conflicts, run the gate, then commit. Merge only a green stream. After the squash merge, remove the stream's worktree and branch: `git wt rm simplify-internals-<stream>`, then `git branch -D simplify-internals-<stream>`. Don't touch worktrees you didn't create; `/home/gpahal/Dev/js/jslib` is the owner's `main` checkout.
- **Lockfile conflicts** (`pnpm-lock.yaml`): take the integration branch's version, run `pnpm install` to regenerate it with the merged manifests, and commit the result.
- **Commit messages** follow the repo's `git log` style:
  - A short imperative title with no type prefix, such as `Move upstream canaries to their own task and drop the build hash`.
  - A blank line, then a body of `- ` bullets, one per change.
  - End with the co-author trailer your harness specifies.
  - A stream's squash commit has one title for the stream, with its items as bullets.
- **Stream briefs:** when spawning a stream agent, give it this file's path and its stream section. Tell it to read Ground rules and Git workflow, and which files it owns. It must not edit files owned by another concurrent stream; if it needs to, it records the need in its report and the parent handles it after merging.
- **At the end:** once everything is implemented and verified, delete every temporary file and this plan file, as Phase 4 describes. The plan file goes in a final commit titled `Remove the implementation plan`. Leave the branch unpushed.

## Orchestration and phases

At most 4 stream agents run at once. Each stream runs only its own packages' tasks while working, for example `pnpm turbo run build typecheck test lint-check --filter <pkg>...`. Only the parent runs the full gate, after each merge.

| Phase | Streams (in parallel) | Starts after |
| --- | --- | --- |
| 0 | Parent: setup and baseline | None |
| 1 | A tooling and test infra, B eslint-config source, C stylelint-config, D internal/prettier/std/font-fallback | Phase 0 |
| 2 | E eslint-config test trims, F cross-package consolidation | All of Phase 1 merged |
| 3 | Parent or one agent: top-level type imports, repo-wide | Phase 2 merged |
| 4 | Parent: final verification, report, plan removal | Phase 3 merged |

Merge order within Phase 1: A first, since it changes every package's scripts and Vitest configs; then rebase B, C and D onto the new integration head before merging them, one at a time.

**Who owns which files in Phase 1:**

| Stream | Owns |
| --- | --- |
| A | Root `vitest.config.ts`, `turbo.json`, every `packages/*/vitest.config.ts` and `packages/*/turbo.json`, the `scripts` of every `packages/*/package.json`, `.github/workflows/ci.yml`, `knip.jsonc`, root `package.json`, `pnpm-workspace.yaml`, `AGENTS.md`, the root README's testing and recipe sections, the new `packages/recipes/**`, `packages/stylelint-config/tests/setup-recipes.test.ts` and `fix-script.test.ts` (moved), `packages/tsconfig/tests/package.test.ts` |
| B | `packages/eslint-config/src/**`, `scripts/**`, `README.md`, and the eslint-config test files its bug fixes and picks need. Not `vitest.config.ts`, and not the files Phase 2 stream E restructures beyond adding or updating cases. Not `src/internal/peers.ts`, which belongs to F. |
| C | `packages/stylelint-config/src/**`, `README.md`, and its tests except the two A moves |
| D | `packages/internal/**` (except files A owns), `packages/prettier-config/**`, `packages/std/**`, `packages/font-fallback/**` (except files A owns) |

The scripts and Vitest configs of B, C and D's packages belong to A. If B, C or D needs a change there, it notes it and the parent applies it after merging.

## Phase 0: setup and baseline

1. **Commit the plan.** In the integration worktree, check that the branch is `refactor/simplify-internals` at `24b109e` with a clean tree. Commit this file as `Add the implementation plan for simplifying internals`.
2. **Install, build and baseline.** Run `pnpm install --frozen-lockfile`, `pnpm build`, then `pnpm check`. Record whether it passed and its wall time.
3. **Record timings.** Time `pnpm turbo run test --force` and `pnpm turbo run test-canaries --force`, plus each package's test wall time from Turbo's output. Keep the numbers for the before/after table in the report.
4. **Optional repro material.** The reviewers left scratch reproductions in `/tmp`; they may be gone, so don't depend on them:
   - `/tmp/eslrev`, `/tmp/eslbug.KJmx`, `/tmp/mdfork.JyKE`, `/tmp/cl.T9pl`, `/tmp/cla.RuU4`: eslint-config.
   - `/tmp/slc-6bjq`, `/tmp/slctw-bbSD`, `/tmp/slf-131b`: stylelint-config.
   - `/tmp/tmp.gt1dshzBmK`: prettier-config and internal.
   - `/tmp/tmp.b8eTiapOUs`: font-fallback.
   - `/tmp/gp-review`, `/tmp/jslib-timing`, `/tmp/perfile.tsv`: profiles and timings.

## Phase 1, stream A: tooling and test infrastructure

### A1. Select canaries with Vitest projects; run them only in CI

**Today:**

- `VITEST_CANARIES=0/1` in every package's `test`/`test-canaries` scripts picks the test set. The root `vitest.config.ts` reads it (`isCanaryRun`, `CANARIES`, `isCanary`, the include/exclude switch, and the canary filtering in `withSharedModules`), and `turbo.json`'s `test-canaries` task declares `env: ["VITEST_CANARIES"]`.
- Canaries live in `tests/**/*.canary.test.ts` in eslint-config (3 files), font-fallback, prettier-config, stylelint-config and tsconfig.
- `pnpm check` runs `test-canaries`, and CI runs it as its own job.

**Target:** no environment variable. Each Vitest config defines named projects, and the scripts select them with `--project`. Canaries run only in CI's `test-canaries` job, or on demand with `pnpm turbo run test-canaries`.

**Root config:** the root `vitest.config.ts` exports a config whose `test.projects` are:

- `tests`: includes `tests/**/*.test.ts` and excludes `configDefaults.exclude`, `tests/tmp/**` and `tests/**/*.canary.test.ts`.
- `canaries`: includes `tests/**/*.canary.test.ts`.

Keep the shared options on each project: `globals`, `update: 'none'`, `env`, timeouts and `execArgv`. Keep the existing comments that explain them.

**Shared-module packages:** `withSharedModules(isolated)` returns these projects:

- `tests` (shared, `isolate: false`), which excludes the isolated files and the canaries;
- `tests-isolated`, holding only the listed files that aren't canaries, and present only when that list is non-empty;
- `canaries`.

Check whether a canary must run isolated (eslint-config's isolated list has none today).

**Package scripts:**

- `test` becomes `vitest run [--config ../../vitest.config.ts] --project 'tests*'`. Check that the installed Vitest supports wildcards in `--project`; if not, pass `--project tests --project tests-isolated`.
- `test-canaries` becomes `... --project canaries`.

**Remove:**

- `VITEST_CANARIES` from every script, `turbo.json` and the root config.
- `test-canaries` from the root `check` script.

**CI** (`.github/workflows/ci.yml`):

- Keep the `test-canaries` matrix job.
- Update the "Check that the jobs run the tasks of `pnpm check`" step, so that `check`'s tasks plus the CI-only `test-canaries` equal the matrix's tasks. Keep the comment saying canaries are CI-only.
- Prefer deriving the expected list over the hard-coded string, if that stays simple.

**Docs:** update AGENTS.md ("Canaries … run in the `test-canaries` task, which `pnpm check` runs and `pnpm test` leaves out") and the README's mentions to say canaries run only in CI and on demand with `pnpm turbo run test-canaries`.

**Acceptance:**

- `pnpm test` runs no canary.
- `pnpm turbo run test-canaries` runs all and only the canaries in every package that has them.
- Packages without canaries have no `test-canaries` script.
- An exported `VITEST_CANARIES` has no effect. Commit #11 fixed exactly that bug, so add or keep a check for it.

### A2. Move eslint-config's warning-code parsing into its own Vitest config

**Today:**

- The root `vitest.config.ts` regex-parses `packages/eslint-config/src/internal/utils.ts` (`readWarningCodes`) to build `--disable-warning=<code>` `execArgv` for every package.
- `turbo.json` therefore lists `$TURBO_ROOT$/packages/eslint-config/src/internal/utils.ts` in the root `test` and `test-canaries` inputs. Editing that file invalidates the test cache of all 7 packages.

**Change:**

- Move `readWarningCodes` and its `execArgv` into `packages/eslint-config/vitest.config.ts`, reading `./src/internal/utils.ts` relative to that file, which is already in the package's `$TURBO_DEFAULT$`. Keep its error message shape and comment.
- Remove both `utils.ts` inputs from the root `turbo.json`.

**Check first:** confirm no other package's tests trigger `GPAHAL_*` warnings in-process (stylelint recipes spawn ESLint as child processes, which print anyway). If one does, give that package the same `execArgv`.

**Keep:** `withSharedModules` stays in the root config, because A3 makes stylelint-config use it too.

### A3. Run stylelint-config's tests with shared modules

- **Change:** give `packages/stylelint-config/vitest.config.ts` the shared-modules config (`withSharedModules([...])`, with any file that needs isolation listed and its reason given, as in eslint-config's config). The reviewer measured 6.4 s → 4.1 s on 4 CPUs, with all 451 tests passing under `--no-isolate`.
- **Acceptance:** the suite passes 3 runs in a row, and once under `pnpm check`.
- **Leave alone:** don't do this for font-fallback, where one test fails under `--no-isolate`, or for the other packages, where the gain is negligible.

### A4. Give tsconfig a release-check task

`packages/tsconfig/tests/package.test.ts` runs publint inside a test because tsconfig has no `typecheck-release` task.

- **Change:** add a `typecheck-release` script to `packages/tsconfig/package.json` running what applies to a JSON-only package (`publint --strict`; attw doesn't apply without types). Remove the publint part from the test.
- **Keep:** anything else that test checks. Delete the file only if nothing is left.
- **Check:** the task appears in `pnpm check` through Turbo, as it does for the other packages.

### A5. Move the setup recipes into a private `packages/recipes`

**Today:**

- `packages/stylelint-config/tests/setup-recipes.test.ts` (832 lines) runs the root README's setup recipes end to end. Because of it, stylelint-config carries dev dependencies on astro, @astrojs/check, next, react, react-dom, vite, @vitejs/plugin-react, @types/react, @types/react-dom, @gpahal/eslint-config and @gpahal/tsconfig.
- That in turn means 12 knip `ignoreDependencies` entries, an `--exclude` in its `test` script, and README inputs in its `turbo.json`.
- `tests/fix-script.test.ts` (117 lines) separately runs the README's "Running the fixers" scripts, with its own copies of `readScripts` and `runScript`.

**Create the package:** add `packages/recipes`, a private package (`"private": true`, not published, no changesets), following AGENTS.md's "New packages" steps that apply:

- Copy a similar package's manifest, scripts and tsconfigs.
- Test scripts pass `--config ../../vitest.config.ts`.
- Add it to `workspaces` in `knip.jsonc`, and add a short README.
- A LICENSE symlink is optional for a private package; follow the checklist anyway for consistency.

**Move into it:**

- `setup-recipes.test.ts` and the dev dependencies only it needs.
- The `test-recipes` script, with its raised `--test-timeout` and the comment explaining it.
- The `turbo.json` inputs for the root README and the tsconfig presets.

**Fold in `fix-script`:** turn fix-script's check (the `fix` script keeps running after an ESLint error and exits non-zero) into a step of the minimal recipe case. Then delete `fix-script.test.ts` and the duplicated helpers. Keep all 5 recipes: minimal, monorepo, Vite, Next.js and Astro.

**Clean up stylelint-config:** remove the moved dev dependencies, its `--exclude`, the recipe inputs in its `turbo.json`, and the knip ignores that no longer apply. Re-check knip for the new package.

**Update docs:**

- AGENTS.md says recipes "run in stylelint-config's `tests/setup-recipes.test.ts`", in the `test-recipes` task, which `pnpm check` runs, and gives `pnpm turbo run test-recipes` to run them alone. Keep the run command, and keep the rule that every recipe file block has its first-line file-name comment.
- Update the root README if it names the location.

**Acceptance:** `pnpm turbo run test-recipes` runs the same 5 recipes plus the fix-script step and passes, `pnpm check` runs it, and the CI `test-recipes` job still runs it.

### A6. Cache Turbo's local cache in CI

**Today:** every CI job rebuilds and retests every package; the workflow says "No remote Turbo cache".

**Change:** add an `actions/cache` step before `pnpm turbo run`:

- **Pinning:** pin by full commit SHA with a version comment, like the other actions. Look up the latest release's SHA with `gh api repos/actions/cache/releases/latest` and `gh api repos/actions/cache/git/ref/tags/<tag>`.
- **Path:** Turbo's local cache directory. Verify where Turbo 2.11 writes it; by default it's `.turbo/cache` at the repository root.
- **Key:** `turbo-${{ runner.os }}-${{ matrix.name }}-${{ github.sha }}`, with `restore-keys: turbo-${{ runner.os }}-${{ matrix.name }}-`, so each matrix job keeps its own cache.

**Keep:**

- `./scripts/verify-no-git-changes.sh` after the tasks. Turbo restores `package.json` from cache for `build`, so the check still catches stale exports.
- A comment explaining the cache scope. GitHub scopes PR caches to the PR's ref, so a PR can't write main's cache.

**Remove:** the "No remote Turbo cache" comment, or reword it.

**Acceptance:** the workflow is valid YAML, and `actionlint` passes if it's installed. Don't install it if it isn't.

### A7. Update AGENTS.md for everything stream A changes

This covers:

- the canary selection (A1);
- where `WARNING_CODES` flags come from (A2);
- shared modules in stylelint-config (A3); if it adds rules for shared-module test files like eslint-config's, document them;
- the recipes package (A5).

Keep AGENTS.md terse and in its current voice.

## Phase 1, stream B: eslint-config source

Every rule or config change here follows the eslint-config procedure in Ground rules. Update `packages/eslint-config/README.md` wherever it describes changed behavior: the duplicate-rules tables, fix policy, `no-node-imports` and the warnings or errors lists.

### Bug fixes

**B-E2. comment-layout turns docs on a later declarator into `//`**

- **Where:** `src/internal/comment-layout/index.ts` about lines 432-438. `addModuleDeclarations` anchors only the whole statement, so a comment between declarators falls to `checkUnattached` (about lines 846-893).
- **Repro:** `export const a = 1,\n  /** doc b */\n  b = 2\n` is fixed to `// doc b`, and TypeScript loses `b`'s JSDoc.
- **Fix:** for a module-level `VariableDeclaration`, including one under `ExportNamedDeclaration.declaration`, add `declarations.slice(1)` as anchors (or optional anchors), so a `/**` before a later declarator is a doc block.
- **Test:** the input above keeps its `/**`.

**B-E3. comment-layout reports commented-out members in code without semicolons**

- **Where:** `src/internal/comment-layout/classify.ts` about lines 276-277 (`CODE_LINE`), used by `isNoteLine` in `index.ts` about line 741.
- **Repro:** these get a `doc` report with a suggestion to make them doc blocks:
  - `// | 'b'` between union members;
  - `// b: number` in a type literal;
  - `// private b = 2` or `// async load(id: string): Promise<void>` in a class;
  - `// B,` in an enum;
  - `// b?: number` in an interface.
- **Fix:** widen `CODE_LINE` to recognize, roughly:
  - union members: `^\|\s*\S`;
  - class and type members: optional modifiers (`private|protected|public|readonly|static|abstract|declare|override|async|get|set`), a name with optional `?`/`!`, then `:`, `=` or `(`;
  - enum members: `^[A-Z][\w$]*(?:\s*=\s*\S+)?,$`.
- **Tune against prose:** "Note: x", "TODO: y", "Example: z" and sentences ending in a colon must still count as notes. Check the existing comment-layout tests and the repo's own code with `pnpm lint` for new misses.
- **ReDoS:** time the new regexes on 50k-character adversarial strings; each must stay linear.
- **Test:** all 6 cases above, plus prose counter-cases.

**B-E4. comment-layout turns an `.astro` frontmatter module header into `//`**

- **Where:** `src/internal/comment-layout/index.ts` about lines 797-815 (`isModuleHeader`). astro-eslint-parser emits the opening `---` as a Punctuator token at `[0, 3]`.
- **Fix:** also treat a previous token whose value is `---` with `range[0] === 0` as the start of the file.
- **Test:** an `.astro` file `---\n/** header */\nimport X from './x'\n---` keeps its `/**` header.

**B-E5. comment-layout misses a multi-line `/**` inside a JSX expression container**

- **Where:** `src/internal/comment-layout/text.ts` about lines 125-128. `indentBefore(..., '{')` returns `undefined` when the block is on its own line inside the container.
- **Fix:** when the `'{'` lookup fails, retry with `''`.
- **Test:** `<div title={\n    /** a\n     * b */\n    String(p.x)\n  } />` is reported like the same block in an arrow function body.

**B-E6. Markdown ` ```html ` blocks with a raw U+2028 or U+2029 report on the wrong lines**

- **Where:** `src/internal/markdown/processor/blocks.ts` about line 44 (`JS_LINE_BREAK_EXTENSIONS`), used by `getCodeLineStarts` about lines 82-88. `@html-eslint/parser` runs on ESLint's JS language, which counts U+2028 and U+2029 as line breaks.
- **Fix:** add `'html'`, and rename the constant or comment it to say it lists the languages whose `SourceCode` counts JS line breaks.
- **Test:** a reported problem on the line after a U+2028 inside an html block maps to the right Markdown line and column.

**B-E7. Segments starting with a negated extglob, such as `src/!(legacy)`, are read as literal names**

- **Where:** `src/internal/globs.ts` about line 64 (`hasGlobMagic`), which feeds `glob-match.ts` about line 59 (`canExpandedMatchFile`) and `preset-languages.ts` about line 215 (`getGlobLanguages`). `matchesName` in `preset-languages.ts` about line 54 and `matchesSegment` in `globs.ts` about line 159 share the cause: single segments are compiled with minimatch, which reads a leading `!` as whole-pattern negation.
- **Fix:** compile segment-level patterns with `{ dot: true, nonegate: true }` through a separate helper and cache (for example `hasSegmentMagic`/`createSegmentMatcher`), and use it everywhere a single segment is matched. Whole-glob negation, where this package supports it, keeps working.
- **Tests:**
  - `testFiles: ['tests/!(fixtures)']` no longer throws "matches no JavaScript or TypeScript file".
  - `configs: [{ files: ['src/!(legacy)'], rules: { 'unicorn/no-null': 'error' } }]` in a project with `src/data.json` lints without ESLint's "rules do not support the language" crash, the same as `src/*` does.

**B-E8. A `language` config of yours whose `files` name a folder is invisible to scoping**

- **Where:** `src/internal/preset-languages.ts` about line 46 (`ANY_FOLDER_NAME_REGEX`) and about lines 99-104 (`getEntryNames`, which returns `[]` for an entry with a folder glob). `getLanguageSources`, `getLanguageIgnores` and `getMatchedLanguages`, used by `splitUnscoped`/`splitScoped` in `user-configs.ts`, then never leave those files out.
- **Owner's choice:** use the last segment. For an entry whose glob names folders, fall back to its last segment as the name, so `src/**/*.css` counts as `*.css`. This errs on the safe side: JavaScript rules skip every `.css` file, which they can't run on anyway. Update the comment about lines 30-32 that admits the approximation.
- **Tests:** these lint without ESLint's unattributed crash; the user rule is scoped away from those files:
  - `configs: [{ files: ['cfg/*.code-workspace'], language: 'json/jsonc', plugins: { json } }, { rules: { 'unicorn/no-null': 'error' } }]`;
  - the same with `{ files: ['cfg/**'], rules: {...} }` as the second config;
  - `{ files: ['src/**/*.css'], language: 'css/css' }` if `@eslint/css` is installed.

### Owner-approved behavior changes

**B-P2. The interface → type fix becomes report-only.** **Behavior change.** This replaces fixing bug E1: the fix turned `interface JsonObject extends Record<string, Json> {}` into a circular type alias (TS2456).

- **Remove the fix machinery** in `src/internal/fixes.ts`, about lines 731-1084:
  - `patchTypeDefinitions`;
  - `isVisibleOutsideFile`, `mergesWithAnotherDeclaration`, `isGlobalAugmentation`, `refersToItself`, `usesThisType`, `hasHeritageComment`, `emptyExtensionFix`;
  - their registration about line 1100;
  - any settings or symbols used only by them.
- **Make the rule report-only:** add `@typescript-eslint/consistent-type-definitions` to the list in `src/internal/fix-policy.ts`, with a reason comment in that file's style. The rule keeps reporting, with no fix.
- **Remove the dependents:**
  - the `keepsFixes` special case in `DUPLICATE_REPORTS` (`src/internal/duplicate-rules.ts`), if only this used it;
  - the canaries in `tests/upstream-workarounds.canary.test.ts` that exist only for this fix (about 3);
  - tests of the removed fix behavior.
- **Keep:** the `isInAmbientModule` exemption if the rule should still not report inside ambient modules. Check whether it governed reporting or only fixing.
- **Update:** the README's description of this rule and of its fix; the fix-output fixtures and snapshot.
- **Test:** an interface still produces a report, and `--fix` leaves it unchanged.

**B-P4. Settle contradicting rule pairs in config instead of runtime patches.** **Behavior change.**

- **Turn off:**
  - `@typescript-eslint/prefer-regexp-exec`, since `unicorn/prefer-regexp-test` and `e18e/prefer-regex-test` cover the condition case;
  - `unicorn/prefer-array-from-map`;
  - `e18e/prefer-array-from-map`;
  - `e18e/prefer-spread-syntax`, since core `prefer-object-spread` (on in `configs/javascript.ts`) covers `Object.assign({}, a)`, and `unicorn/prefer-spread` covers `Array.from(s)` and `a.concat(b)`.
- **Keep on:** `unicorn/prefer-spread`, `unicorn/prefer-iterator-to-array` and core `prefer-spread`.
- **Remove from `src/internal/fixes.ts`** (about lines 1119-1389) whatever existed only to arbitrate these pairs:
  - `patchRegexpExec`, `findRegexpTestRule`;
  - `patchArrayFromMap` and `iteratorToArrayCompanions`;
  - the array-from-map part of `patchPreferSpread` and `arrayFromMapCompanions`;
  - `ARRAY_FROM_MESSAGES` entries for removed rules;
  - `mergeListeners` and the companion-context helpers, if nothing else uses them.
- **Keep a small type-aware guard** on `unicorn/prefer-spread` so it doesn't report `Array.from(x)` when `x` has no `[Symbol.iterator]` in any union member (`isNonIterableArrayFrom`, with `any`/`unknown` counting as iterable). Spreading such a value throws, so reporting it is a false positive. Use the simplest wrapper: a report filter through the existing `patchRule` machinery, not a companion rule.
- **Update `src/internal/duplicate-rules.ts`:**
  - remove `DUPLICATE_REPORTS`/`DUPLICATE_RULES`/overlap entries about these pairs (about lines 386-387, 427-434, 467-472, 496, and others found by grepping the rule names);
  - register any remaining overlap as AGENTS.md requires.
- **Update:** the README's duplicate-rules tables, fix policy and rule lists; the inventory and fix-output snapshots.
- **Tests:** none of the removed rules is on in any area (the inventory shows this). `Array.from(arrayLike)` with an `ArrayLike<number>` type isn't reported, and `Array.from(new Set(a))` still is.

**B-P5. Drop `no-node-imports`' browserify-shim exemption.** **Behavior change.**

- **Where:** `src/internal/no-node-imports.ts`.
- **Remove:**
  - `BROWSER_SHIMS` (about line 71);
  - `getExportTarget`, `isExportedTarget`, `hasSubpath`;
  - `createFileLookups` and the per-file `findUp('package.json')` lookup (about line 37);
  - the declared-shim filtering about lines 99-111.
- **Keep:** the rule's name, its node built-in detection, its handling of type-only imports, and its message. Reword the message only if it mentions shims.
- **Optional:** if the rule now matches what `no-restricted-imports` with `builtinModules` plus `node:*` patterns and `allowTypeImports` would do, you may alias the core rule through `aliasCoreRule` in `plugin.ts`, as long as the reported name and message stay the same. Otherwise keep the custom rule, shortened.
- **Update:** the README section for the rule.
- **Test:** `import { Buffer } from 'buffer'` in a browser file is reported even when the nearest `package.json` declares `buffer`.

### Behavior-preserving cleanups

Each cleanup must leave the inventory and fix-output snapshots unchanged.

- **B-C1. Use upstream AST helpers.** Replace the hand-written `getStaticString` (`no-node-imports.ts` about line 258, `no-js-specifier-for-ts.ts` about line 35) with `ASTUtils.getStringIfConstant`. Replace `findVariable` (`rule-patches.ts` about line 506) and `getPropertyName` (`plugin.ts` about line 84, `nextjs-server-component.ts` about line 100) with `ASTUtils` equivalents, where semantics match exactly. Check `getStringIfConstant`'s handling of template literals and static concatenation against the current helper, and keep the custom one if they differ in a way tests pin.
- **B-C2. Deduplicate small helpers inside eslint-config.**
  - The type-wrapper node sets (`plugin.ts` about line 100, `nextjs-server-component.ts` about line 57, `fixes.ts` about line 122), `isTypeofOperand` (2 copies), and the range and node guards (`rangeOf`, `untypedRangeOf`, `isRuleNode`, `isNodeOfType` in `fixes.ts`; `rangeOf`, `assertedTypeRangeOf` in `rule-patches.ts`; `isNode` in `ast.ts`) all move into `src/internal/ast.ts`.
  - Replace the hand-written binary searches (`while (low < high)`, about 10) with one helper, where the search contract is the same.
  - The type-only import checks (`no-node-imports.ts` about line 288, `fixes.ts` about lines 359-376) share one helper.
  - `nextjs-server-component` reuses `@gpahal/no-browser-globals`' browser-global check, if it's the same check.
- **B-C3. One list joiner.** The "a, b and c" or "and N more" joining is written about 6 times:
  - `user-configs.ts` (`formatKinds` about line 509, and about line 1027);
  - `peers.ts` about line 126 (with an inconsistent Oxford comma; leave `peers.ts` to F, which can adopt the helper);
  - `project-scan.ts` about lines 95-98;
  - `resolve.ts` (`formatExamples` about line 522, and about lines 657-661).

  First check whether `@gpahal/std/errors`' `formatNames` already covers it, perhaps with an option. If not, add one private helper in `@gpahal/internal`, not public std. Keep message wording, and settle on one comma style, logged as a text change.

- **B-C4.** In `resolve.ts`, about line 1060-1068 the `new Map(…JSON.stringify…).values().toArray()` dedupe uses `uniqueBy`, and about lines 826-832 use `unique`, both from `@gpahal/std/arrays`.
- **B-C5.** `slop/no-em-dash` (`presets/antislop.ts` about lines 112-170) computes LF-only line and column positions with its own binary search, then `withLanguageColumnsRule({ lfLines: true })` converts them back. Report `sourceCode.getLocFromIndex(start/end)` directly, and drop the `lfLines` round trip if nothing else needs it. Keep the stock fallback used when `inspection` isn't `full`.
- **B-C6.** In the `sonarjs/unverified-certificate` patch (`rule-patches.ts` about line 590, `tlsExportOf`), check the callee or constructor name against `Agent`, `TLSSocket`, `connect` and the other names it looks for before the scope lookup, so most calls skip `findVariable`.
- **B-C7.** `manifests.ts` about line 10 imports `yaml` statically. Load it lazily where it's used, if the callers are already async or the parse can move to an async path without restructuring. Otherwise skip and note.
- **B-C8.** `composer.ts` about lines 743-747: `getContext()` recomputes `getPresets` and `getPlugins` over all configs for every operation. Cache it per config-list state, invalidated whenever the list changes. Skip if invalidation isn't obviously correct.
- **B-C9.** `user-configs.ts` about lines 1645-1648 re-checks every split part with `checkRuleLanguages` on every load ("A rejected part is a bug in the split"). Move that check into a test that runs the split over representative configs, and drop it from the runtime path.
- **B-C10.** `relative-globs.ts` about lines 14-24 (`withOptionsRoot`): replace the mutable module-level state with an explicit parameter passed to the functions that need the root for their message. The message stays the same.
- **B-C11.** `manifests.ts` about lines 116-178 (`findWorkspaceFolders`) is a second breadth-first scan, up to 5000 folders, alongside `scanProject`, which already returns `packageFolders`. If `packageFolders` provably covers the same folders with the same limits and ignores, use it for `usesReactCompiler` and other callers and delete the second scan. If the two differ in any case a test or the README relies on, skip and note.

## Phase 1, stream C: stylelint-config

Every rule change follows the Stylelint procedure in Ground rules. Update `packages/stylelint-config/README.md` where behavior or errors change.

### Bug fixes

**C-S1. An extended `defineConfig`-built config overrides the outer config's Tailwind settings.** **Behavior change**, approved, with a README exception.

- **Where:**
  - `src/internal/define.ts` about lines 648-675: each built config puts its own preset settings in a plain `presetLayer` object inside `extends`.
  - `src/internal/extends.ts` about lines 214-224: `loadExtends` exempts only base-package files (`isBaseConfigFile`), so an extended `presetLayer` counts as a user config.
  - `define.ts` about lines 377-382: the rules of an extended `presetLayer` go through `replaceLayer` and replace the outer preset's and Tailwind's settings whole.
- **Repro:** a shared `stylelint.config.mjs` = `defineConfig({ root })`, and an app = `defineConfig({ root, extends: ['../../stylelint.config.mjs'], tailwindcss: true })`. `extends: ['@gpahal/stylelint-config']` with `tailwindcss: true` does the same. A Tailwind file that lints clean without the extends then gets `function-no-unknown` on `theme`, `hue-degree-notation`, and an empty line before a custom property in `@theme`. `--fix` damages the file.
- **Fix:** mark preset layers in a module-level `WeakSet` filled in `createConfigBuilder`. In `loadExtends`, treat a source in that set like a base config: its rules don't count as user rules, and it's left out in `collectOptions`. The outer config's own options then decide the preset settings.
- **README:** document the exception next to the base-config one in "Rule merging", and in the Overrides section that recommends sharing `defineConfig`-built presets.
- **Tests:** both repro shapes lint the Tailwind file the same as the app config without the extends. A user rule set in the extended config still beats the preset.

**C-S2. `tailwindcss.validateApply` silently does nothing when the config extends a `defineConfig`-built config.**

- **Where:** `define.ts` about lines 688-699 registers `tailwindApply(tailwindDesign)` in each config's `plugins`, and `tailwind-apply.ts` about lines 410-421 gives a config without a design a shared inactive plugin. Stylelint puts an extended config's plugins after the config's own, and the last plugin registered for a rule name wins, so the extended config's inactive `@gpahal/tailwind-apply` replaces the outer, active one.
- **Repro:** shared = `defineConfig({ root, tailwindcss: true })`; app = `defineConfig({ root, extends: [shared], tailwindcss: { entryPoint: '../../theme.css', validateApply: true } })`. `a { @apply flex nope; }` is clean.
- **Fix:** pick the simpler, robust option:
  - (a) when the outer config has a design, remove plugin objects whose `ruleName` is `@gpahal/tailwind-apply` from the loaded extended configs and their overrides, in `loadExtends`/`normalizeLoadedConfig`;
  - (b) register one shared plugin and pass the design through the rule's secondary options.

  C-S1's preset-layer marking may make (a) natural.

- **Tests:** the repro reports `Unexpected unknown utility class "nope"`. The reverse case, with `validateApply` set only in the extended config, still works.

**C-S3. With `tailwindcss` on, `--fix` breaks legacy `theme()` key paths.**

- **Where:** `preset-rules.ts` about line 68 sets `value-keyword-case: lower`, and `tailwindcss.ts` about lines 252-271 (`tailwindcssConfig`) doesn't exempt `theme()`.
- **Repro:** `font-size: theme(fontSize.sm)` is reported, and `--fix` writes `theme(fontsize.sm)`, which Tailwind can't resolve.
- **Fix:** in the Tailwind variant's merged rules, set `'value-keyword-case': ['lower', { ignoreFunctions: ['theme'] }]` so it merges with any user secondary options as the README describes. Check whether `--theme()` arguments need the same; custom property names are case-sensitive.
- **Tests:** `theme(fontSize.sm)` and `theme(lineHeight.tight)` aren't reported or changed. `currentColor` is still lowercased.

**C-S4. `@gpahal/tailwind-theme-function` reports paths Tailwind resolves through its JS default theme.**

- **Where:** `tailwind-theme-function.ts`, in `variableOf` and the known-variable check (about lines 312-337 and 376).
- **Repro:** `theme(borderRadius.full)` and `theme(lineHeight.none)` are reported as unknown, though Tailwind compiles them to `9999px` and `1`. Also affected:
  - `aspectRatio.square`, `boxShadow.none`, `lineHeight.3`–`10`, `transitionTimingFunction.linear`, `animation.none`;
  - mapped namespaces after a `--x-*: initial` reset, except `colors` and `containers`.
- **Owner's choice:** a path is known if the CSS theme has it, or if the installed `tailwindcss` default theme resolves it. Find the right import for the installed Tailwind (for example `tailwindcss/defaultTheme`, and check that it exists in v4), resolved from the user's entry point as the rest of the Tailwind code resolves `tailwindcss`. Typos are still reported.
- **README:** narrow its list of checked legacy keys to match.
- **Tests:** the paths above aren't reported; `theme(borderRadius.nope)` still is.

**C-S5. With `validateApply`, a bad `@apply` or `theme()` inside an `@utility` in the entry file makes `defineConfig` throw.**

- **Where:** `tailwind-apply.ts` about lines 64-86 (`designOnly`) keeps `@utility` bodies whole. Tailwind throws in `compile()`, so the `catch` around `build()` about line 302, whose comment names this case, never runs.
- **Owner's choice:** fix the compile. In `designOnly`, replace an `@apply` inside a kept at-rule with a placeholder declaration, and drop `theme()`/`--theme()` there, so the design compiles and the rule reports the bad `@apply` when the file is linted. Correct the comment.
- **Test:** entry `@import "tailwindcss"; @utility bad { @apply nope; }` loads, and linting it reports `nope`.

### Owner-approved behavior change

**C-P6. A cheaper `referenceFiles` check.** **Behavior change.**

- **Where:** `src/internal/paths.ts` about lines 245-561, `checkReferencePathsExist` and its helpers: a symlinked-folder walker, brace-expansion progress states, a 100k-entry budget and five error variants. They walk the file system on every config load.
- **Change:**
  - Keep the "doesn't exist" error, with its current message, for entries that aren't globs. Check them with a stat.
  - Remove the walker. Glob entries pass through to Stylelint unchecked, so a glob that matches nothing no longer throws at config time.
  - Remove the error variants that only the walker produced.
- **Docs:** update the README's thrown-errors list, around line 368.
- **Tests:** keep and adjust the literal-path tests; remove the walker's tests and list them in the report.

### Test trims in stylelint-config

- **C-T1. Loosen brittle pins.**
  - `tests/define.test.ts` about line 320: `KNOWN_OPTIONS` pins all 29 option names in order. Assert the unknown-option case with a regex on `` `tailwind`: unknown option `` instead.
  - About lines 324-393 pin 16 complete error texts. Keep about 4 representative full-text cases as the error-shape contract, and match the subject or prefix for the rest.
- **C-T2. Gather the precedence tests.** Extended configs beating the preset is tested 4 times: `define.test.ts` about line 203, `rules.test.ts` about lines 533-595, `config-loading.test.ts` about lines 544-606 and `replaced-stock-rules.test.ts` about lines 123-149. Gather them into one `describe` in `rules.test.ts`. Keep each distinct angle, such as stock-rule replacement, as a case, and drop exact repeats.

## Phase 1, stream D: internal, prettier-config, std, font-fallback

**D1. Trim dead code from `packages/internal/src/node/zod.ts`.** Owner's choice: dead code only; messages unchanged.

- **Before removing a branch:** grep every `z.` schema in the repo to prove nothing reaches it.
- **Remove:**
  - `describeBound`, `SIZE_UNITS`, `SIZE_RELATIONS`, `DATE_RELATIONS`, `NUMBER_RELATIONS`, `pluralize` (about lines 415-482);
  - the discriminator and xor branches of `describeUnion` (about lines 399-410);
  - unused `TYPE_NAMES` entries (about lines 318-338).
- **Keep:**
  - the symbol-key handling (`strictObject`'s `superRefine`, the symbol tokens in `uniqueIssues`, the `Symbol(...)` paths in `formatPath`);
  - `withoutPrototype` and the `__proto__: null` copies;
  - `MAX_ISSUES` truncation and key shortening.
- **Tests:** internal's tests and every package's option-validation tests pass unchanged.

**D2. Replace internal's hand-written Node `exports` resolver, if parity is proven.** Conditional.

- **Where:** `packages/internal/src/node/resolve.ts`, about lines 322-637: `resolveInPackage`, `resolveExports`, `resolveTarget`, `resolveTargetString`, `findInFolder`, `getPackageName`. Together they re-implement Node's `exports` algorithm plus main fields and extension probing.
- **Replacement:** `import-meta-resolve`'s `moduleResolve(specifier, parentURL, new Set(conditions))`, plus a small fallback for the CSS callers: `style` field, `.css`, `index.css`. The callers are stylelint-config's `tailwindcss.ts` about line 540 and `tailwind-apply.ts` about lines 164-198, and they must keep working.
- **Callers:**
  - prettier-config: `plugins.ts` about lines 59-77, `index.ts` about lines 194-206;
  - eslint-config: 2 imports;
  - stylelint-config: 9 imports.

  Whichever bundling package lacks `import-meta-resolve` gets it as a dependency. It's already a stylelint-config dependency.

- **Parity condition:**
  - Every existing resolve test passes unchanged: internal's `tests/node/resolve.test.ts` and the callers' tests.
  - The behaviors the bug hunt verified still hold: pattern-key priority, `null` targets, nested conditions, path-traversal rejection (`..`, `.`, symlinks leaving the package) under both pnpm and npm layouts, percent-encoded targets.
  - Resolution must ignore `NODE_PATH`; this is why the custom resolver exists, and ESM resolution doesn't read it.
- **If any of this fails,** or the fallback grows past about 60 lines, skip the item and note why.
- **Also, independently:** module resolution currently happens three different ways (prettier's `resolvePluginName`, stylelint's `resolveModulePath` in `paths.ts` about lines 134-154, internal's `resolvePath`). If D2 lands, route the other two through the same helper where semantics match.

**D3. `mergeConfigs` throws when a plain plugin duplicates one the preset wraps.** Owner's choice: throw a clear error.

- **Where:** `packages/prettier-config/src/internal/merge.ts` about lines 612-674 (`checkConfigsToMerge`) and about line 408 (`sorterOf`).
- **Repro:** `mergeConfigs(defineConfig({}), { plugins: ['@ianvs/prettier-plugin-sort-imports'] })` keeps both the preset's sort-imports wrapper and the plain plugin. The plain one wins, so a `// @ts-expect-error` above an import is no longer pinned and moves onto the wrong import. `prettier-plugin-packagejson` has the same gap.
- **Fix:** in `checkConfigsToMerge`, throw a `TypeError` built with `formatMessage` when one config has the preset's wrapper and another adds the plain plugin it wraps. Cover the sorter, packagejson and astro, and any other plugin the preset wraps. Example message: `` `plugins`: `@ianvs/prettier-plugin-sort-imports` is added by config 1's preset. Remove it ``.
- **Comment:** update the `sorterOf` comment ("The sorter itself wins over the wrapper") to match.
- **README:** around lines 228 and 273, document that merged configs reject this duplicate.
- **Tests:** each wrapped plugin throws the message. Two configs that both come from `defineConfig` still merge.

**D4. `getErrorMessage` drops an inner message next to non-BMP letters.**

- **Where:** `packages/std/src/errors.ts` about lines 357-359 (`isWordCharAt`, which uses `value.at(index)`) and about lines 391-392 (`holdsWords`).
- **Repro:** `getErrorMessage(new AggregateError([new Error('野家')], '𠮷野家 failed'))` returns `'𠮷野家 failed'`; with `吉` it correctly returns `'吉野家 failed: 野家'`.
- **Fix:** test whole code points:
  - before the match: `/[\p{L}\p{N}_]$/u` on `text.slice(Math.max(0, index - 2), index)`;
  - after the match: `/^[\p{L}\p{N}_]/u` on `text.slice(end, end + 2)`;
  - likewise for `part`'s first and last characters.
- **Test:** both repros, plus `x𝐀 failed` with an inner `x`.

**D5. A non-ASCII space after `url(` gets past font-fallback's `fontFaceProperties` check.**

- **Where:** `packages/font-fallback/src/internal/options.ts` about line 163 (`isClosed`: `!/^\s*'/.test(value.slice(index + 1))`). JS `\s` matches U+00A0 and U+3000, but CSS whitespace is only space, tab and newline.
- **Repro:** `fontFaceProperties: { 'font-display': "url( ') (' )" }` is accepted, and the emitted `@font-face` swallows every later rule.
- **Fix:** use `/^[ \t\n]*'/` (CR and FF are already rejected as controls). Audit the module's other `\s` uses in CSS-safety checks for the same mistake.
- **Test:** NBSP and U+3000 variants are rejected with the existing "unquoted `url()`" or unclosed error; `'swap'` and valid quoted `url('x')` values still pass.

**D6. Merge std's two doctest programs.**

- **Where:** `packages/std/tests/readme.test.ts` and `jsdoc.test.ts` each build a full TypeScript program.
- **Change:** compile README and JSDoc examples in one program, shared by both test files or merged into one file. Keep execution and the result-comment checks, which AGENTS.md mandates, and keep `helpers.ts`' supported comment forms.
- **Acceptance:** the same examples are checked, and std's test time drops.

**D7. A prettier-config test depends on how it's invoked.**

- **Where:** `packages/prettier-config/tests/index.test.ts` about lines 523-544 ("warns once when the Tailwind plugin is 0.9.0"). It passes under `pnpm test` and fails under `npx vitest`. `installTailwind` (about line 450) makes a temporary project with no lockfile, so `formatInstallCommand` falls back to `npm_config_user_agent`.
- **Fix:** write a `pnpm-lock.yaml` into that temporary project, so detection is deterministic. Check for other tests with the same pattern (grep `installTailwind` and similar temp-project helpers).
- **Acceptance:** the test passes both with `npm_config_user_agent` unset and with it set to an npm user agent.

## Phase 2, stream E: eslint-config test trims

Starts after Phase 1 is merged, so B's new regression tests are already in place; keep all of them. Coverage loss in E3–E6 is approved; list each dropped case in the report with what it covered.

- **E1. One guard-rails test** instead of the message tables duplicated in `tests/validate.test.ts` (1158 lines) and `tests/composer.test.ts` (1441 lines).
  - **Duplicated checks** (composer repeats each once per composer method, ×5):
    - formatting-rule rejection: composer about lines 790-842 and 1001; validate about line 396, about lines 1002-1062;
    - a rule for non-code files in a config without `files`: composer about line 1010; validate about lines 465-501;
    - unknown rule: validate about lines 414 and 878;
    - `languageOptions.math`: composer about line 1112; validate about line 516;
    - project service options: validate about line 1105.
  - **Bad-glob matrix:** validate about lines 187-221 run 7 options × 5 bad globs, all through `checkRelativeGlobsAt`.
  - **Change:** write a table of `[label, () => build(...)]` whose thrown messages go into one `toMatchSnapshot()`. Exercise each check through one composer method only.
  - **Composer coverage:** add one test proving every composer method routes user configs through `checkUserConfig`, so a single bad config is rejected by each method.
  - **Keep in composer:** method order, re-running on fresh copies, `override` merging, split configs, config copies, the un-awaited composer.
  - **Glob matrix:** reduce to one glob per bad-glob kind, plus one test per option proving it goes through `checkRelativeGlobsAt`.
- **E2. Fold the typed-fix tests into fix-output.**
  - `tests/presets-code.test.ts` about lines 482-646 (`fixTypedProjects`, `fixTypedProjectsOnce`, `TYPED_BATCHES`, `loadsModule`) and the `removeUnused` and interface-merge cases about lines 678-870 fix, fix again, then run `tsc`, which is fix-output's pattern.
  - Move those inputs into `tests/fixtures/fix-output/src`, turn on `imports: { removeUnused: true }` in the fix-output run if needed, and delete the batching code.
  - Keep the "only reports in an editor" case as a small test of its own.
  - Interface-merge cases tied to the removed interface fix (B-P2) are gone already; don't re-add them.
- **E3. Consolidate the project and git tests.**
  - `tests/presets-project.test.ts` about lines 240-830 creates about 25 temporary git repos checked against `git check-ignore`. Replace them with one fixture repo holding every pattern, and one comparison with git as the oracle.
  - Keep, as small explicit cases, corner cases that don't fit the fixture **and** guard a past bug (check `git log -S` / blame on the code they cover): submodules, `core.ignorecase`, a symlinked `.gitignore`, `[!x]`.
  - Reduce the read-count tests (`options.test.ts` about lines 732-828, `presets-project.test.ts` about line 707) to one.
  - Replace the warning-wording tests (`options.test.ts` about lines 944-1019, `default-project-warnings.test.ts`, and the relevant parts of `type-aware-ignores.test.ts` and `root-paths.test.ts`) with one snapshot of `warningsOf` over 3–4 projects. Keep the `allowDefaultProject` behavior permutations (`options.test.ts` about lines 230-538) only where they assert distinct behavior, not distinct wording.
- **E4. Check duplicate rules once.** `tests/duplicate-rules.test.ts` about lines 99-187 runs 6 `KEPT_AREAS_OFF` configs × 4 `OPTION_SETS` × 18–30 files × 2 ESLint instances. Keep only "every option on", and run the overlap check over the per-file configs that `inventory.test.ts` already resolves. Keep the "reports once" lint probes (about lines 233-431), updated for B-P4.
- **E5. Drop 3 child-process tests.**
  - `composer.test.ts` about line 1226, the unhandled-rejection plumbing;
  - `options.test.ts` about lines 637-730, `lintRootsInChild`;
  - `editor.test.ts` about line 98, the ESLint bin with `--concurrency 2`. Keep the worker-path check about line 84.
- **E6. One option-inventory snapshot.**
  - Replace these option-permutation tests:
    - e18e options ×3 (`presets-code.test.ts` about line 1114);
    - commonjs and framework hints (about lines 237-315);
    - the browser/server option (about lines 1235-1474);
    - tailwind `entryPoint` permutations (`presets-frameworks.test.ts` about lines 347-400);
    - `testFiles` and vitest file globs (`options.test.ts` about lines 93-163).
  - **The snapshot:** for about 15 option variants, record how the rules that are on differ from the all-presets inventory, for 1–2 representative files each. Reuse inventory's `diffOf`.
  - **Keep** tests that lint code to prove a rule reports: patched rules, misfires, globals reported once.
- **E7. Helper code used by one test.**
  - Inline `tests/fix-helpers.ts` (`fixFiles`, `reportFiles`, the ESLint cache, AsyncLocalStorage), which only `report-only.test.ts` uses, by calling `createFocusedESLint` with `fix: true`.
  - Replace `tests/helpers.ts`' `typeErrors` and its SourceFile cache, which one test uses (`rules.test.ts` about line 96), with a plain program or an existing helper.
- **E8. Loosen brittle pins.** Where a full error or warning text is pinned and a snapshot (E1, E3) already holds the shape, match the subject instead.
- **Update AGENTS.md** if the isolated-file list, `CORE_AREAS_OFF` use or the eslint-config testing notes change.
- **Report:** the eslint-config test line count and the `pnpm --filter @gpahal/eslint-config test` CPU and wall time, before and after.

## Phase 2, stream F: cross-package consolidation

**F1. One helper for "resolve `tailwindcss.entryPoint`, then check it's a file."** It exists three times: prettier-config `options.ts` about lines 498-540, eslint-config `validate.ts` about lines 463-490 (with its `resolveEntryPoint`), and stylelint-config `tailwindcss.ts` about lines 470-495. Commit d5a7130 already shares the error between stylelint-config and prettier-config. Add one function to `@gpahal/internal/node/...` (next to the shared path error), taking the package prefix for messages, and use it in all three. Messages stay the same, or are harmonized and logged.

**F2. One semver-based peer-version checker.**

- **Where:** `semver` is already a dependency of eslint-config (`src/internal/peers.ts`). prettier-config hand-rolls its version checks in `src/internal/plugins.ts` about lines 210-330: `MIN_SORT_IMPORTS_VERSION`, `MIN_TAILWIND_VERSION`, `isInsidersVersion`, `isAtLeast`, `olderThan`, plus the untested-range warnings.
- **Change:** move the shared logic into `@gpahal/internal/node/<name>` and use it from both packages. The shared logic is:
  - "is version X at least the minimum or inside the range";
  - "newer than the tested range";
  - the install-hint formatting.
- **Dependency:** add `semver` as a runtime dependency of prettier-config (approved), and check knip.
- **Keep** each package's existing warnings and their `GPAHAL_*` codes (documented in the root README's Troubleshooting), its errors, and the insiders-build rule (`0.0.0-…` counts as newer than any release).
- **Also fixes P2:** every install hint goes through `formatPeerSpecifier`, so `^` is shell-quoted. Today `plugins.ts` about lines 277, 306 and 407 build `` `${name}@^${major}.${minor}` `` unquoted, while `formatInstallCommand` in `internal/src/node/package-manager.ts` about line 89 says its packages are "shell-quoted already".
- **Leave alone:** `eslint-config/src/internal/peers.ts` about line 384 writes a YAML value, not a shell argument.
- **Tests:** add one each for an old version, an insiders build, and a version newer than the tested range. The hint for an old Prettier plugin contains `"<name>@^X.Y"` in quotes.
- **Optional:** while in `peers.ts`, adopt B-C3's list joiner.

## Phase 3: top-level type imports

**Behavior change**, approved. Done by one agent, or the parent, after Phase 2 is merged, because the repo-wide autofix touches nearly every package.

**Change the config** in `packages/eslint-config/src/internal/configs/typescript.ts` about lines 119-127 and `configs/imports.ts` about line 236:

- `@typescript-eslint/consistent-type-imports`: `{ prefer: 'type-imports', fixStyle: 'separate-type-imports' }`.
- `import-x/consistent-type-specifier-style`: `['error', 'prefer-top-level']`. Check whether it's on already, and register an overlap in `duplicate-rules.ts` if needed.
- `import-x/no-duplicates`: drop `'prefer-inline': true`, and keep `considerQueryString: true`.
- `@typescript-eslint/consistent-type-exports`: `fixMixedExportsWithInlineTypeSpecifier: false`, so exports use separate `export type {}` too.
- `@typescript-eslint/no-import-type-side-effects`: keep on if it's harmless, or turn it off if `consistent-type-specifier-style` makes it a pure duplicate. Follow the duplicate-rules policy in AGENTS.md.

**Remove** `patchDuplicateImports` in `src/internal/fixes.ts`, about lines 353-526, with `keepsTypeBeforeDefault`, `dropsSideEffectImport` and the `RECORDING_FIXER` use if nothing else needs it. First confirm with fix-output fixtures that `import-x/no-duplicates` without `prefer-inline` produces only valid merges: `import type` and value imports from the same module stay separate.

**Update** the code comments that explain the inline style, and the README's description of import style.

**Then:**

1. Run gen.
2. Build.
3. Update the inventory and fix-output snapshots, including fixtures whose expected output used inline style. Review them.
4. Run `pnpm lint-fix` over the whole repo to convert this repo's own code to top-level type imports.
5. Run `pnpm fmt`, then `pnpm check`.

Also convert README code examples and JSDoc examples with inline `type` specifiers, including std's README examples, which run through `readme.test.ts`.

**Acceptance:** no `import { type …` remains in source or docs, apart from fixtures that test the rule. `pnpm check` and `pnpm turbo run test-canaries` pass.

## Phase 4: final verification and report

1. In the integration worktree, run `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm lint-fix`, `pnpm fmt` (both must leave no changes), then `pnpm check`, `pnpm turbo run test-canaries` and `pnpm turbo run test-recipes`. All must pass, and `git status` must be clean.
2. Re-time the commands from Phase 0 step 3 with `--force`.
3. Check that no changeset was added: `git diff --name-only main -- .changeset` lists nothing new. Also check that `knip` and `pnpm audit --prod` are clean.
4. Write the final report, in the thread, not in a file:
   - **Status per item:** done, skipped with reason, or partially done.
   - **User-visible changes per package,** for the owner's changesets: behavior changes, bug fixes, error or warning text changes (old → new), new dependencies, README changes.
   - **Every error or warning text change,** old → new.
   - **Tests removed or merged,** with what each covered and where that coverage lives now or that it was dropped, as approved.
   - **Before and after numbers:** source and test line counts per package, `pnpm test` and `pnpm check` wall time, the eslint-config suite's CPU and wall time.
   - **Extra small simplifications** made under Latitude.
   - **Proposed follow-ups,** including anything blocked on a decision or a dependency.
5. **Delete temporary files.** Do this once everything is implemented, merged and verified.
   - **Stream worktrees and branches:** remove any left over with `git wt rm <name>`, then `git branch -D <name>`. `git wt list` and `git branch --list 'simplify-internals-*'` must show none. Leave the owner's worktrees alone: `/home/gpahal/Dev/js/jslib` and `/home/gpahal/.t3/worktrees/jslib/t3-3d66a753`.
   - **Scratch folders outside the repo:** delete every one created during this work, plus the review's leftovers listed in Phase 0 step 4: `/tmp/eslrev`, `/tmp/eslbug.KJmx`, `/tmp/mdfork.JyKE`, `/tmp/cl.T9pl`, `/tmp/cla.RuU4`, `/tmp/slc-6bjq`, `/tmp/slctw-bbSD`, `/tmp/slf-131b`, `/tmp/tmp.gt1dshzBmK`, `/tmp/tmp.b8eTiapOUs`, `/tmp/gp-review`, `/tmp/jslib-timing`, `/tmp/x-prof`, `/tmp/perfile.tsv`, `/tmp/eslint-tests.json`, `/tmp/w3-shared.json`, `/tmp/w3-isolated.json`, `/tmp/workers3.txt`. Delete only these paths and the ones you recorded, never a broader glob of `/tmp`.
   - **Inside the repo:** delete Turbo run summaries (`.turbo/runs/`) and leftover `packages/*/tests/tmp/` contents. Then check that `git status --short --ignored` shows nothing new apart from build output, `node_modules`, `.turbo/cache`, `.eslintcache` and `*.tsbuildinfo`.
6. **Delete this plan file** in a final commit titled `Remove the implementation plan`. After it, `git status` is clean. Don't push.

## Out of scope

The owner decided to leave these alone. Don't do them, even partly; mention any new evidence about them as a follow-up only.

- **eslint-config:**
  - the user-config split and its guard checks (`user-configs.ts`, `preset-languages.ts`, `glob-match.ts`), apart from the E7 and E8 fixes and B-C9;
  - the discovery and tsconfig warnings, `default-project.ts`, `hints.ts`;
  - `peers.ts`' semver range warnings and pnpm-alias detection (F2 only shares the checker);
  - `project-service.ts` and the root-spelling guard;
  - the git edge cases in `project-scan.ts`/`git.ts`;
  - composer extras (`describeMissingName`, the un-awaited-composer traps, `onResolved` diffing);
  - JavaScript-only mode;
  - the duplicate-report dedupe (`patchTwin` and `DUPLICATE_REPORTS`, apart from B-P4's pairs);
  - the Markdown processor and the six Markdown rule forks;
  - `comment-layout`'s design (only its bugs are fixed);
  - the `unverified-certificate` extension (only B-C6's ordering);
  - `no-unstrippable-syntax`;
  - `no-js-specifier-for-ts`' `require` handling;
  - `patchPublishingRule`, `patchFilenameCase`, `patchCreateOnce`'s frozen-rule path;
  - `typegen.gen.d.ts`, which stays as is, with full JSDoc and every rule.
- **stylelint-config:** the `extends` re-implementation and `conditional-options.ts` (apart from C-S1 and C-S2); the file-type splitting of overrides; the pass-through keys; the brace diagnostics.
- **prettier-config:** plugin-conflict detection (apart from D3) and its plugin-identity side tables; the "Did you mean" suggestions.
- **internal:** zod's guards (D1 is dead code only); package-manager detection and its shell quoting, including the single-quote branch, which stays as defense in depth.
- **std:** `getErrorMessage`'s hardening (D4 only fixes the boundary bug); runtime type checks; the public modules no other package uses (`promises`, `urls`, `queue`, `match`, `hash`, `envs`, `numbers`, `debounce`/`throttle`); `lazy` and `once`.
- **font-fallback:** its hardening, SSRF checks, `signal.ts`, parser caps and CLI duplication.
- **Tooling:**
  - merging src and tests typechecks into one `tsc` program;
  - moving publint and attw out of `typecheck-release`;
  - per-package versus root ESLint;
  - shared modules for packages other than eslint-config and stylelint-config;
  - dropping any setup recipe;
  - navigation-only test file merges.
- **Upstream:** ESLint core's unused-directive autofix can delete an `eslint-disable-next-line` line sitting between a `/** @ts-expect-error */` and its code, so the TypeScript directive moves onto that code. This is upstream behavior; at most, mention it as a follow-up.

## Status

The implementing agent keeps this table current. Status values are `todo`, `in progress`, `done` and `skipped: <reason>`.

| Item                                                | Stream | Status |
| --------------------------------------------------- | ------ | ------ |
| A1 canaries via Vitest projects, CI-only            | A      | done   |
| A2 warning codes into eslint-config's Vitest config | A      | done   |
| A3 stylelint-config shared modules                  | A      | done   |
| A4 tsconfig release-check task                      | A      | done   |
| A5 private `packages/recipes`                       | A      | done   |
| A6 Turbo cache in CI                                | A      | done   |
| A7 AGENTS.md updates                                | A      | done   |
| B-E2 declarator docs                                | B      | todo   |
| B-E3 commented-out members                          | B      | todo   |
| B-E4 Astro module header                            | B      | todo   |
| B-E5 JSX expression container                       | B      | todo   |
| B-E6 html U+2028 line mapping                       | B      | todo   |
| B-E7 negated extglob segments                       | B      | todo   |
| B-E8 folder-glob language configs                   | B      | todo   |
| B-P2 interface fix report-only (replaces E1)        | B      | todo   |
| B-P4 contradicting rule pairs in config             | B      | todo   |
| B-P5 drop shim exemption                            | B      | todo   |
| B-C1 – B-C11 cleanups                               | B      | todo   |
| C-S1 extended preset layers                         | C      | done   |
| C-S2 validateApply through extends                  | C      | done   |
| C-S3 `theme()` keyword case                         | C      | done   |
| C-S4 default-theme paths                            | C      | done   |
| C-S5 `@utility` compile                             | C      | done   |
| C-P6 cheaper referenceFiles check                   | C      | done   |
| C-T1, C-T2 stylelint test trims                     | C      | done   |
| D1 zod dead code                                    | D      | todo   |
| D2 resolver via import-meta-resolve (conditional)   | D      | todo   |
| D3 mergeConfigs wrapped-plugin error                | D      | todo   |
| D4 getErrorMessage code points                      | D      | todo   |
| D5 font-fallback CSS whitespace                     | D      | todo   |
| D6 std doctests in one program                      | D      | todo   |
| D7 prettier test lockfile                           | D      | todo   |
| E1 – E8 eslint-config test trims                    | E      | todo   |
| F1 shared entryPoint helper                         | F      | todo   |
| F2 shared semver checker (fixes P2)                 | F      | todo   |
| Phase 3 top-level type imports                      | 3      | todo   |
| Phase 4 final verification and report               | 4      | todo   |
| Phase 4 temporary files and plan file deleted       | 4      | todo   |
