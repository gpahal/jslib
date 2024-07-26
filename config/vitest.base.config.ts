/// <reference types="vitest" />
/// <reference types="vite/client" />

import type { UserConfig } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'

const config = {
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
  },
} satisfies UserConfig

export default config
