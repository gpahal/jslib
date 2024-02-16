import { type Config } from 'prettier'

export function addPrettierAstroConfig<T extends Config>(config: T): T {
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
