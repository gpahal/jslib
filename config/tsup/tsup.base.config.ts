import { IGNORED_FILES } from "../ignored-files";

import type { Options } from "tsup";

export function getBaseConfig(options: Options): Options {
  const isDevEnv = process.env["NODE_ENV"] === "development" || !!options.watch;
  return {
    entry: ["src/*"],
    format: ["esm", "cjs"],
    env: {
      NODE_ENV: isDevEnv ? "development" : "production",
    },
    clean: true,
    splitting: false,
    sourcemap: true,
    dts: !isDevEnv,
    minify: !isDevEnv,
    ignoreWatch: IGNORED_FILES,
  };
}
