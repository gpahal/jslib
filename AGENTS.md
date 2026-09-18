# jslib

Monorepo of TypeScript libraries and config presets published as `@gpahal/*`. pnpm workspaces +
Turborepo. Scripts live in the root `package.json`.

**Run `pnpm build` first.** `build/` is gitignored and packages import each other through it, so
typecheck and test fail on a clean checkout without it.

## Gotchas

- tsup and vitest config live in `config/`, re-exported from the repo root; packages have none of
  their own. tsup walks up and finds the root config, vitest does not — so every `test` script
  needs `--config ../../vitest.config.ts`, or the `@/*` alias and `globals` are lost.
- The root `eslint.config.mjs`, `.stylelintrc.cjs` and `.prettierrc.mjs` use this repo's own
  presets. Rebuild a preset package before its changes take effect.
- Types come from tsup's `onSuccess` hook (`tsc` + `tsc-alias`), not `dts`.
- Native build allowlist is `allowBuilds` in `pnpm-workspace.yaml`, not `onlyBuiltDependencies`.
- Pre-push runs typecheck/lint/fmt-check, then build, then fails if the tree is dirty.
- Prettier skips Markdown — wrap `.md` at 100 cols by hand.

## Conventions

ESM only, `sideEffects: false`, Node `>=24`. `stylelint-config` is CJS because Stylelint requires
it. Internal deps use `workspace:*`; config presets declare framework plugins as optional peer
deps.

Packages with many entry points use wildcard `./*` exports plus `typesVersions`; the rest export
`.` only. `tsconfig`, `stylelint-config` and `tailwindcss-variants` ship static files with no build
step.

New package: follow `packages/ADDING_A_PACKAGE.md`. Publish: `pnpm cs`, then `pnpm cs-publish`.
