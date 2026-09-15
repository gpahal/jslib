/// <reference types="vitest" />
/// <reference types="vite/client" />

import type { UserConfig } from 'vite'

const config = {
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    globals: true,
    environment: 'node',
  },
} satisfies UserConfig

export default config
