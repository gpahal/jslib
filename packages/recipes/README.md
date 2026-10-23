# @gpahal/recipes

Private end-to-end checks of the repository, never published.

## Tests

- `tests/setup-recipes.test.ts` runs the root README's [setup recipes](../../README.md#setup-recipes). It writes each recipe's blocks, named by their first-line file-name comment, into a temporary project laid out as pnpm installs it, with the config packages' builds and the apps' frameworks from this workspace. It runs the README's fixers, then the check with Stylelint at `--max-warnings 0`, and checks that `check:types` reports type errors. The minimal recipe also checks that `fix` runs every fixer after an ESLint error, and fails.
- `tests/test-selection.test.ts` checks that each package's `test` script runs no canary, and that its `test-canaries` script runs all of them, even with a `VITEST_CANARIES` variable exported.

## Usage

The setup recipes take minutes, so they run in the `test-recipes` task, which `pnpm check` runs and `pnpm test` leaves out:

```sh
pnpm turbo run test-recipes
```

The `test` task runs the test selection check.
