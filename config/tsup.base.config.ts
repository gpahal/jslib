import type { Options } from 'tsup'

const IGNORE_PATTERNS = [
  '**/.git/**',
  '**/.*.*js',
  '**/*.config.*js',
  '**/.*.*ts',
  '**/*.config.*ts',
  '**/.turbo/**',
  '**/build/**',
  '**/dist/**',
  '**/target/**',
  '**/out/**',
  '**/out-tsc/**',
  '**/.output/**',
  '**/tmp/**',
  '**/.tmp/**',
  '**/.cache/**',
  '**/.eslintcache/**',
  '**/node_modules/**',
  '**/.vscode/**',
  '**/.history/**',
  '**/.idea/**',
  '**/.idea_modules/**',
]

export function getBaseConfig(options: Options): Options {
  const isDevEnv = process.env.NODE_ENV === 'development' || !!options.watch
  return {
    entry: ['src/*'],
    tsconfig: 'tsconfig.build.json',
    outDir: 'build',
    format: ['esm'],
    env: {
      NODE_ENV: isDevEnv ? 'development' : 'production',
    },
    splitting: false,
    clean: true,
    sourcemap: true,
    dts: false,
    minify: !isDevEnv,
    ignoreWatch: IGNORE_PATTERNS,
    external: ['espree'],
    onSuccess: 'tsc -p tsconfig.build.json && tsc-alias -p tsconfig.build.json',
  }
}
