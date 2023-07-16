import { Options } from 'tsup'

import { IGNORED_FILES } from './ignored-files'

export function getBaseConfig(options: Options): Options {
  const isDevEnv = process.env['NODE_ENV'] === 'development' || !!options.watch
  return {
    entry: ['src/*'],
    outDir: 'build',
    format: ['esm', 'cjs'],
    env: {
      NODE_ENV: isDevEnv ? 'development' : 'production',
    },
    clean: true,
    splitting: false,
    sourcemap: true,
    dts: !isDevEnv,
    minify: !isDevEnv,
    ignoreWatch: IGNORED_FILES,
  }
}
