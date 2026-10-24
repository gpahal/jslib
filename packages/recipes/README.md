# @gpahal/recipes

Private end-to-end checks of the repository, never published.

## Tests

- `tests/setup-recipes.test.ts` runs the root README's [setup recipes](../../README.md#setup-recipes). It writes each recipe's blocks, named by their first-line file-name comment, into a temporary project laid out as pnpm installs it, with the config packages' builds and the apps' frameworks from this workspace. It runs the check with Stylelint at `--max-warnings 0`, after the README's fixers for the minimal and Astro recipes and on sources as the fixers leave them for the others, and checks that `check:types` reports type errors. The minimal recipe also checks that `fix` runs every fixer after an ESLint error, and fails.
- `tests/test-selection.test.ts` checks that each package's `test` script runs no canary, and that its `test-canaries` script runs all of them. It exports `VITEST_CANARIES=1` to the scripts to check that such a variable doesn't change the selection.

## Usage

The setup recipes take minutes, so they run in the `test-recipes` task, which `pnpm check` runs and `pnpm test` leaves out:

```sh
pnpm turbo run test-recipes
```

The `test` task runs the test selection check.
