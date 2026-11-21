---
'@gpahal/stylelint-config': patch
---

Require Stylelint 18 and Tailwind CSS 4.3.5, and update `stylelint-config-standard` to 41.0.0, which turns on `value-no-invalid`, so a dotted `theme()` key path such as `theme(colors.red.500)` is reported. `function-no-unknown` stays on, though `stylelint-config-recommended` 19 dropped it. As in Stylelint 18, a path in `extends`, `plugins`, `processors` or `customSyntax` must name a file with its extension, and a `@utility` name reads a one-digit hex escape as Tailwind CSS 4.3.5 does.
