---
'@gpahal/prettier-config': patch
---

Require Prettier 3.10.1, `prettier-plugin-astro` 1.1.2 and `prettier-plugin-tailwindcss` 0.8.1, and update `prettier-plugin-packagejson` to 3.1.0. `.hujson` files, which Prettier 3.10 parses as `jsonc`, keep their trailing commas, which HuJSON allows.
