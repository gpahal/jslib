---
'@gpahal/eslint-config': patch
---

Require ESLint 10.15.0 and the latest release of each preset's plugin, and update `@eslint/markdown` to 9.0.0, whose `no-bare-urls` fix now links a `www.` URL, though not a URL with a character reference or with `|` in a table cell, which rewriting could retarget. Update `eslint-plugin-unicorn` to 80.0.0, with `unicorn/prefer-options-parameter` off, and `eslint-plugin-import-x` to 4.18.1.
