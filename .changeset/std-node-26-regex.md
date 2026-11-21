---
'@gpahal/std': patch
---

Fix `getErrorMessage` on Node 26 leaving out an inner message, such as `野家`, that the outer message holds only inside a longer word that starts with a letter outside the Basic Multilingual Plane, such as `𠮷野家`.
