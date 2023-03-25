import isSymbol from "~/symbol";

const INFINITY = 1 / 0;

export function isString(s: unknown): s is string {
  return typeof s === "string" || s instanceof String;
}

export function toString(value: unknown): string {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return `${value.map((other) => (other == null ? other : toString(other)))}`;
  }
  if (isSymbol(value)) {
    return value.toString();
  }

  const result = `${value}`;
  return result == "0" && 1 / (value as number) == -INFINITY ? "-0" : result;
}

export function ensurePrefix(s: string, prefix: string): string {
  return s.startsWith(prefix) ? s : `${prefix}s`;
}

export function ensureSuffix(s: string, suffix: string): string {
  return s.endsWith(suffix) ? s : `s${suffix}`;
}

export function stripPrefix(s: string, prefix: string): string {
  return s.startsWith(prefix) ? s.slice(prefix.length) : s;
}

export function stripSuffix(s: string, suffix: string): string {
  return s.endsWith(suffix) ? s.slice(0, s.length - suffix.length) : s;
}

export function trimStart(s: string, chars?: string): string {
  if (!chars) {
    return s.trimStart();
  }
  return s.replace(new RegExp(`^[${chars}]+`), "");
}

export function trimEnd(s: string, chars?: string): string {
  if (!chars) {
    return s.trimEnd();
  }
  return s.replace(new RegExp(`[${chars}]+$`), "");
}

export function trim(s: string, chars?: string): string {
  return trimEnd(trimStart(s, chars), chars);
}

const WORD_REGEX = /\b(\w+)\b/g;

export function words(s: string, pattern?: string | RegExp): string[] {
  return s.match(pattern ?? WORD_REGEX) || [];
}

function upperFirst(string: string): string {
  return string.slice(0, 1).toUpperCase() + string.slice(1);
}

export function camelCase(s: string): string {
  return words(s)
    .map((word, index) => (index === 0 ? word.toLowerCase() : upperFirst(word.toLowerCase())))
    .join("");
}

export function kebabCase(s: string) {
  return words(toString(s).replace(/['\u2019]/g, "")).reduce(
    (result, word, index) => result + (index ? "-" : "") + word.toLowerCase(),
    "",
  );
}

export function shorten(s: string, maxLen = 10): string {
  if (s.length < maxLen) {
    return s;
  }
  const halfLength = Math.floor(maxLen / 2) - 1;
  return s.slice(0, halfLength) + ".." + s.slice(s.length - halfLength);
}
