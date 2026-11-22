# @gpahal/stylelint-config

## 0.0.32

### Patch Changes

- [#33](https://github.com/gpahal/jslib/pull/33) [`6679625`](https://github.com/gpahal/jslib/commit/66796256c115dfe3fada6fdfb57a77a3102e2b31) Thanks [@gpahal](https://github.com/gpahal)! - Require Stylelint 18 and Tailwind CSS 4.3.5, and update `stylelint-config-standard` to 41.0.0, which turns on `value-no-invalid`, so a dotted `theme()` key path such as `theme(colors.red.500)` is reported. `function-no-unknown` stays on, though `stylelint-config-recommended` 19 dropped it. As in Stylelint 18, a path in `extends`, `plugins`, `processors` or `customSyntax` must name a file with its extension, and a `@utility` name reads a one-digit hex escape as Tailwind CSS 4.3.5 does.
- Updated dependencies [[`6679625`](https://github.com/gpahal/jslib/commit/66796256c115dfe3fada6fdfb57a77a3102e2b31)]:
  - @gpahal/std@0.0.54

## 0.0.31

### Patch Changes

- [#31](https://github.com/gpahal/jslib/pull/31) [`350a9b5`](https://github.com/gpahal/jslib/commit/350a9b5910647f4ddd11ee8b6e2a826e561caa42) Thanks [@gpahal](https://github.com/gpahal)! - Declare dependency versions through the workspace's pnpm catalog. Published version ranges are unchanged.
- Updated dependencies [[`350a9b5`](https://github.com/gpahal/jslib/commit/350a9b5910647f4ddd11ee8b6e2a826e561caa42)]:
  - @gpahal/std@0.0.53

## 0.0.30

### Patch Changes

- [#29](https://github.com/gpahal/jslib/pull/29) [`d8147ef`](https://github.com/gpahal/jslib/commit/d8147ef29e5107ac9c2f0087ad4f5dc9884b3be5) Thanks [@gpahal](https://github.com/gpahal)! - Update `minimatch` to 11.0.2 and other dependencies to their latest minor and patch versions, including `typescript-eslint` 8.72.1, `eslint-plugin-package-json` 1.12.0, `prettier-plugin-packagejson` 3.0.3 and `postcss` 8.5.32.
- Updated dependencies [[`d8147ef`](https://github.com/gpahal/jslib/commit/d8147ef29e5107ac9c2f0087ad4f5dc9884b3be5)]:
  - @gpahal/std@0.0.52

## 0.0.29

### Patch Changes

- [#25](https://github.com/gpahal/jslib/pull/25) [`edb333f`](https://github.com/gpahal/jslib/commit/edb333f4433409b4b5cc9a98e02a341c2c996c78) Thanks [@gpahal](https://github.com/gpahal)! - Update `stylelint-config-recess-order` to 7.9.0, which orders `field-sizing`, `text-box`, `text-autospace`, SVG geometry and MathML properties.
- Updated dependencies [[`edb333f`](https://github.com/gpahal/jslib/commit/edb333f4433409b4b5cc9a98e02a341c2c996c78)]:
  - @gpahal/std@0.0.51

## 0.0.28

### Patch Changes

- [#22](https://github.com/gpahal/jslib/pull/22) [`6a2f9b3`](https://github.com/gpahal/jslib/commit/6a2f9b30f11e809d1e60a9fc000d023b02a238c6) Thanks [@gpahal](https://github.com/gpahal)! - Build with tsdown 0.23.2.
- Updated dependencies [[`6a2f9b3`](https://github.com/gpahal/jslib/commit/6a2f9b30f11e809d1e60a9fc000d023b02a238c6)]:
  - @gpahal/std@0.0.50
