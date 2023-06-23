/// <reference types="vitest" />
/// <reference types="vite/client" />

import { UserConfig } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'

const config = {
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
  },
} satisfies UserConfig

export default config
