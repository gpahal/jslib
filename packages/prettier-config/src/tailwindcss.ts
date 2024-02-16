import { type Config } from 'prettier'

export function addPrettierTailwindConfig<T extends Config>(
  config: T,
  tailwindConfig?: string,
): T & { tailwindConfig?: string } {
  return {
    ...config,
    plugins: [...(config.plugins || []), 'prettier-plugin-tailwindcss'],
    tailwindConfig: tailwindConfig || './tailwind.config.js',
  }
}
