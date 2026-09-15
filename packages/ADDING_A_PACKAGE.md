# Adding a package

- [ ] Add directory and make sure it's "name" field in `package.json` is unique
- [ ] Use existing templates for `package.json`, `tsconfig.json` and `tsconfig.build.json` (tsup and
      vitest use the shared root configs, so no per-package config files are needed)
- [ ] If the package has tests, set its `test` script to `vitest run --config ../../vitest.config.ts`
- [ ] Add `README.md` with a description of the package
- [ ] Add root `tsconfig.json` entry
