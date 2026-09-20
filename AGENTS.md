# jslib

Monorepo of TypeScript libraries and config presets published as `@gpahal/*`. pnpm workspaces + Turborepo; every script lives in the root `package.json`. ESM only, `sideEffects: false`, Node `>=24`.

**Run `pnpm build` first.** Packages resolve each other through gitignored `build/`, so a package's own `typecheck`/`test` script — and the editor — fails on a clean checkout. Root `pnpm typecheck`/`pnpm test` build first via `turbo.json`.

## Gotchas

- tsup and vitest config live in `config/`, re-exported from the repo root; packages have none of their own. tsup walks up and finds the root config, vitest does not — so every `test` script needs `--config ../../vitest.config.ts`, or `globals` and `environment: 'node'` are lost.
- tsup's entry is `src/*`: every top-level file in `src/` becomes a build artifact, and in the wildcard-export packages a public entry point.
- Tests live in a package's top-level `tests/` as `*.test.ts`, never beside the source. `globals` is on, so nothing is imported from `vitest`.
- Types come from tsup's `onSuccess` hook (`tsc` + `tsc-alias`), not `dts`. `@/*` maps to `./src/*`; `tsc-alias` rewrites it at build time.
- `eslint.config.mjs`, `.stylelintrc.cjs` and `.prettierrc.mjs` consume this repo's own presets — rebuild `eslint-config`/`prettier-config` before their changes take effect.
- `pnpm fmt` formats Markdown with `proseWrap: never` — write each paragraph and list item as one unwrapped line.
- Native build allowlist is `allowBuilds` in `pnpm-workspace.yaml`, not `onlyBuiltDependencies`.
- There is no CI. The pre-push hook is the only gate: `typecheck`/`lint`/`fmt-check`, then `build`, then it fails if the tree is dirty.

## Conventions

ESLint enforces what formatting cannot fix: kebab-case filenames, `type` over `interface`, `Array<T>` over `T[]`, and `import type`. Prettier handles the rest (no semicolons, single quotes, sorted imports) — run `pnpm fmt`.

`stylelint-config` is CJS, shipping a single `base.js` consumed by `.stylelintrc.cjs`. Internal deps use `workspace:*`; `eslint-config` declares its framework plugins as optional peer deps.

New package: follow `packages/ADDING_A_PACKAGE.md`. Publish: `pnpm cs` (bumps versions immediately), then `pnpm cs-publish`.
