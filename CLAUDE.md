# CLAUDE.md

Monorepo of TypeScript libraries and config presets published under the `@gpahal` scope. pnpm
workspaces + Turborepo. Package list: see `README.md`.

## Commands

```bash
pnpm build          # turbo run build
pnpm typecheck      # turbo run typecheck (tsc --noEmit per package)
pnpm test           # turbo run test (depends on build)
pnpm lint           # eslint + stylelint
pnpm lint-fix
pnpm fmt            # prettier --write (pnpm fmt-check to verify)
pnpm clean          # per-package clean + remove .turbo
```

Single package: `cd packages/<name> && pnpm test` (or
`pnpm exec vitest --config ../../vitest.config.ts`
for watch, `pnpm dev` for tsup watch).

Pre-push hook (`simple-git-hooks`) runs `typecheck`/`lint`/`fmt-check` in parallel, then `build`,
then `scripts/verify-no-git-changes.sh` — so committed build output must be up to date.

## Conventions

- **ESM only**, `sideEffects: false`, Node `>=24`.
- Internal deps use `workspace:*`. Config presets declare framework plugins as **optional** peer
  deps.
- Native build allowlist lives under `allowBuilds` in `pnpm-workspace.yaml` (not
  `onlyBuiltDependencies`).

## Package layout

```txt
packages/<name>/
├── src/                 # source; path alias @/* → ./src/*
├── tests/               # *.test.ts (only std, font-fallback, tailwindcss-color-themes have tests)
├── build/               # generated
├── tsconfig.json        # extends config/tsconfig.base.json; includes src, tests, scripts, @types
└── tsconfig.build.json  # extends config/tsconfig.build.base.json; src only, emitDeclarationOnly
```

There are **no per-package `tsup.config.ts` / `vitest.config.ts` files**. The root `tsup.config.ts` /
`vitest.config.ts` re-export `config/tsup.base.config.ts` and `config/vitest.base.config.ts`. tsup
walks up to the root config; vitest does not, so each package's `test` script passes
`--config ../../vitest.config.ts` explicitly (without it the `@/*` alias and `globals` are lost). Add
package-local configs only if a package genuinely needs to diverge.

tsup builds `src/*` → `build/` as ESM with sourcemaps and `dts: false`; declarations come from the
`onSuccess` hook running `tsc -p tsconfig.build.json && tsc-alias -p tsconfig.build.json`.

## Exports

Utility/preset packages with many entry points use wildcard exports plus `typesVersions`, enabling
`import { ... } from '@gpahal/std/arrays'`:

```json
{
  "exports": {
    "./package.json": "./package.json",
    "./*": { "import": "./build/*.js", "types": "./build/*.d.ts" }
  }
}
```

Single-entry packages (`logger`, `image`, `image-node`, `font`, `font-fallback`,
`remark-preset-lint`, `tailwindcss-color-themes`) export `.` only; `og-image` also exports `./wasm`.
`tsconfig`, `stylelint-config` and `tailwindcss-variants` ship static files (JSON, CJS config,
`index.css`) with no build step.

## Adding a package

Checklist in `packages/ADDING_A_PACKAGE.md`. Copy `package.json` and both tsconfigs from the closest
existing package, add a `README.md`, and add a `references` entry in the root `tsconfig.json` (only
packages that emit types need one). If the package has tests, its `test` script must be
`vitest run --config ../../vitest.config.ts`.

## Publishing

`pnpm cs` runs `changeset && changeset version` (changeset creation and version bump in one step).
`pnpm cs-publish` then runs typecheck/lint/fmt-check, tests, `changeset publish`, and deletes local
git tags.
