import { type Config } from 'prettier'

type PluginEntry = NonNullable<Config['plugins']>[number]

function isTailwindPlugin(plugin: PluginEntry): boolean {
  return plugin === 'prettier-plugin-tailwindcss'
}

export function addPrettierAstroConfig<T extends Config>(config: T): T {
  const plugins = config.plugins || []

  return {
    ...config,
    // prettier-plugin-tailwindcss must be last so it wraps the parsers of the plugins before it
    plugins: [
      ...plugins.filter((p) => !isTailwindPlugin(p)),
      'prettier-plugin-astro',
      ...plugins.filter((p) => isTailwindPlugin(p)),
    ],
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
