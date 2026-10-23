---
'@gpahal/eslint-config': patch
'@gpahal/prettier-config': patch
'@gpahal/stylelint-config': patch
---

The packages share one copy each of their internal file, path and TypeScript-loading helpers; results and errors are unchanged.
