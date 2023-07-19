/** @typedef  {import("prettier").Config} PrettierConfig */
/** @typedef  {{ tailwindConfig?: string }} PrettierTailwindConfig */

/**
 * @function
 * @template {PrettierConfig} T
 *
 * @param {T} config
 * @param {string | undefined} tailwindConfig
 * @returns {T & PrettierTailwindConfig}
 */
function addPrettierTailwindConfig(config, tailwindConfig) {
  return {
    ...config,
    plugins: [...(config.plugins || []), 'prettier-plugin-tailwindcss'],
    tailwindConfig: tailwindConfig || './tailwind.config.cjs',
  }
}

module.exports = {
  addPrettierTailwindConfig,
}
