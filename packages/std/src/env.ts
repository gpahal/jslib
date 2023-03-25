export const isWindows = process?.platform === "win32";
export const isBrowser = typeof document !== "undefined" && !!document;
