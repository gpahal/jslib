/// <reference types="vitest" />
/// <reference types="vite/client" />

import tsconfigPaths from "vite-tsconfig-paths";

import type { UserConfig } from "vite";

const config = {
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: "node",
  },
} satisfies UserConfig;

export default config;
