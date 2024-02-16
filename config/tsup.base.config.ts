import { Options } from 'tsup'

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
    ignoreWatch: IGNORE_PATTERNS,
    external: ['espree'],
  }
}
