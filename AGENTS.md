# jslib

Monorepo of TypeScript libraries and config presets published under the `@gpahal` scope. pnpm
workspaces + Turborepo. Package list: see `README.md`.

## Commands

```bash
pnpm build          # turbo run build
pnpm typecheck      # turbo run typecheck
pnpm test           # turbo run test
pnpm lint           # eslint + stylelint (pnpm lint-fix to fix)
pnpm fmt            # prettier --write (pnpm fmt-check to verify)
```

Single package: `cd packages/<name> && pnpm test`, or `pnpm dev` for tsup watch.

`build/` is gitignored and packages resolve each other through it, so **run `pnpm build` first** —
typecheck and test fail on a clean checkout without it.

## Gotchas

- There are **no per-package `tsup.config.ts` / `vitest.config.ts`**; both live in `config/` and are
  re-exported from the repo root. tsup finds the root config by walking up, vitest does not — hence
  the `--config ../../vitest.config.ts` in every `test` script. Without it the `@/*` alias and
  `globals` are lost.
- The root `eslint.config.mjs`, `.stylelintrc.cjs` and `.prettierrc.mjs` use this repo's own presets
  via `workspace:*`. Editing a preset does nothing until that package is rebuilt.
- Declarations come from tsup's `onSuccess` hook (`tsc -p tsconfig.build.json && tsc-alias`), not
  from `dts`.
- Native build allowlist is `allowBuilds` in `pnpm-workspace.yaml`, not `onlyBuiltDependencies`.
- Pre-push runs typecheck/lint/fmt-check, then build, then fails if the tree is dirty.

## Conventions

ESM only, `sideEffects: false`, Node `>=24` (`stylelint-config` is CJS — Stylelint requires it).
Internal deps use `workspace:*`; config presets declare framework plugins as optional peer deps.
Prettier is 100 cols, no semicolons, single quotes, and does not cover Markdown — wrap `.md` by
hand.

Packages with many entry points (`std`, `std-node`, `eslint-config`, `prettier-config`) use wildcard
`./*` exports plus `typesVersions`; the rest export `.` only. `tsconfig`, `stylelint-config` and
`tailwindcss-variants` ship static files with no build step.

## Adding a package

Follow `packages/ADDING_A_PACKAGE.md` — copy the closest existing package's `package.json` and both
tsconfigs, and add a root `tsconfig.json` reference if it emits types.

## Publishing

`pnpm cs` (changeset + version bump), then `pnpm cs-publish`.
