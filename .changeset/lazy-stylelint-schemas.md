---
'@gpahal/stylelint-config': patch
---

The static presets load without Zod or cosmiconfig, so importing them takes about 10% less time; options, configs and errors are unchanged.
