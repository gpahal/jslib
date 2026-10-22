---
'@gpahal/eslint-config': patch
---

Compiles each glob once per process, so checking configs, as `.onResolved()` and the other composer methods do, takes a fraction of the time.
