---
'@gpahal/eslint-config': patch
'@gpahal/font-fallback': patch
'@gpahal/prettier-config': patch
'@gpahal/std': patch
'@gpahal/stylelint-config': patch
---

Source maps no longer carry the `x_sourceHashes` field, which only the repo's tests read.
