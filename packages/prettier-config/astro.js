/** @typedef  {import("prettier").Config} PrettierConfig */

/**
 * @function
 * @template {PrettierConfig} T
 *
 * @param {T} config
 * @returns {T}
 */
function addPrettierAstroConfig(config) {
  return {
    ...config,
    plugins: [...(config.plugins || []), 'prettier-plugin-astro'],
    overrides: [
      ...(config.overrides || []),
      {
        files: '*.astro',
        options: {
          parser: 'astro',
          astroAllowShorthand: false,
        },
      },
    ],
  }
}

module.exports = {
  addPrettierAstroConfig,
}
