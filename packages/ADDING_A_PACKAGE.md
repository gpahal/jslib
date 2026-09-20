# Adding a package

- [ ] Add directory and make sure it's "name" field in `package.json` is unique
- [ ] Use existing templates for `package.json`, `tsconfig.json` and `tsconfig.build.json` (tsup and vitest use the shared root configs, so no per-package config files are needed)
- [ ] Many entry points → wildcard `./*` exports plus `typesVersions`; otherwise export `.` only
- [ ] If the package has tests, set its `test` script to `vitest run --config ../../vitest.config.ts` and put them in a top-level `tests/` directory
- [ ] Add `README.md` with a description of the package
- [ ] Add root `tsconfig.json` entry
