#!/usr/bin/env node
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs, styleText, type ParseArgsConfig } from 'node:util'

import { formatCliError, readPackageVersion } from '@gpahal/internal/node/cli'
import {
  describeValue,
  formatMessage,
  formatNames,
  getErrorMessage,
  getErrorReason,
} from '@gpahal/std/errors'
import { escapeControls } from '@gpahal/std/strings'

import {
  DEFAULT_FALLBACKS,
  getFontFallbacks,
  type FontCategory,
  type FontFallback,
  type FontFallbacks,
} from '@/index'
import { toPercentage } from '@/internal/css'
import {
  formatDefaultFallbacksMessage,
  getDefaultFallbacksIssues,
} from '@/internal/fallback-metrics'
import { findFamily, getCaseHint } from '@/internal/families'
import { isReadAtOpticalSize, OPTICAL_SIZE } from '@/internal/optical-size'
import {
  CONFLICT_DESCRIPTION,
  EXPECTED_CATEGORY,
  EXPECTED_FAMILY_NAME,
  EXPECTED_FONT_FACE_NAME,
  getFamilyKey,
  isFamilyName,
  isFontFaceName,
  PREFIX,
} from '@/internal/options'
import {
  checkSource,
  HTTPS_REGEX,
  PATH_LIKE_REGEX,
  readAtMost,
  SCHEME_REGEX,
  TOO_LARGE,
} from '@/internal/sources'

const HELP = String.raw`Usage: font-fallback <font> [-c sans-serif|serif|monospace] [-f <family>]... [-n <name>] [--css | --json]

Prints the size-adjusted local fallbacks of a web font's regular face: its font-family stack, the
overrides of each fallback and the @font-face rules.

<font> is read in this order: - reads the font file's bytes from stdin, as in
curl -H 'Authorization: ...' <url> | font-fallback - -n <name> -c sans-serif. An argument that
starts with https:// is fetched, and a file: URL, such as file:///fonts/f.ttf, is a font file.
One that starts with another <scheme>:, such as http:, is rejected, though a Windows path such as
C:\fonts\f.ttf isn't a scheme; prefix a path such as fonts:f.ttf with ./. One that has a / or \,
or ends in a font extension such as .ttf, .otf, .woff2, .woff or .ttc, is a font file, relative to
the current directory. Only .ttf, .otf and .woff2 files are read. Anything else is the exact name
of a family in @capsizecss/metrics, such as Inter. A font that starts with -, such as the file
-f.ttf, goes after the options and --: font-fallback --css -n F -c serif -- -f.ttf. A fallback
that starts with - goes after =: --fallback=-apple-system.

A font file, URL or stdin needs -n, the font-family name of your @font-face, and -c or -f unless
-n names a family in @capsizecss/metrics. Family names are letters, digits, single spaces and
hyphens, and -n can also have underscores and periods. Fonts are trusted input: don't pass files
or URLs from users.

Options:
  -c, --category <category>  sans-serif, serif or monospace, which picks the default fallbacks
  -f, --fallback <family>    A local family to fall back to, in place of the defaults, so not
                             with -c. Repeat it for more than one
  -n, --name <name>          The web font's font-family name, which the fallback names start
                             with. Required for a font file, URL or stdin
      --css                  Print only the @font-face rules
      --json                 Print the rules, the font-family stack and the fallbacks as JSON
  -h, --help                 Show this help
      --version              Show the version`

/**
 * A family with a face suffix, such as `Inter:wght@400` or `Open Sans:ital,wght@1,700`, which
 * would otherwise read as a URL of the scheme `Inter:`
 */
const FACE_SUFFIX_REGEX = /^[^:/\\]+:[a-z]{4}(?:,[a-z]{4})*@[^/\\]*$/i

const STDIN_ARG = '-'

/**
 * A `file:` URL with a path, as the library takes. `file:f.ttf` would parse as `/f.ttf`, so it's
 * rejected rather than read from the root
 */
const FILE_URL_REGEX = /^file:\//i

/**
 * The command-line font: `-` for stdin, an `https:` URL or a family name, which the library checks,
 * or a font file, as a path or a `file:` URL. A face suffix is left to the library, which rejects
 * it without echoing it. A scheme is checked before the extension, so a URL of another scheme,
 * which can hold credentials, isn't read as a path and echoed
 */
async function parseSource(font: string): Promise<string | URL | Uint8Array> {
  if (font === STDIN_ARG) {
    return readStdin()
  }
  if (HTTPS_REGEX.test(font) || FACE_SUFFIX_REGEX.test(font)) {
    return font
  }
  const scheme = SCHEME_REGEX.exec(font)?.[0]
  if (scheme !== undefined) {
    const url = FILE_URL_REGEX.test(font) ? URL.parse(font) : null
    if (url !== null) {
      return url
    }
    throw new TypeError(
      formatMessage(
        PREFIX,
        ['font'],
        `expected an https:// URL, a font path or a family name, received a string that starts with ${describeValue(scheme)}${getSchemeHint(scheme, font)}`,
      ),
    )
  }
  return PATH_LIKE_REGEX.test(font) ? pathToFileURL(path.resolve(font)) : font
}

/**
 * The fix for a font argument of a scheme the CLI rejects, as a sentence after `. `, or `''`
 */
function getSchemeHint(scheme: string, font: string): string {
  switch (scheme.toLowerCase()) {
    case 'http:': {
      return '. Pass its https:// URL'
    }
    case 'file:': {
      return ". Pass the font's path, or a file:/// URL"
    }
    case 'data:': {
      return '. Decode it and pipe the bytes to `-`'
    }
    default: {
      return PATH_LIKE_REGEX.test(font) ? ". If it's a path, prefix it with `./`" : ''
    }
  }
}

/**
 * The bytes of stdin
 *
 * @throws If stdin is a terminal, or once it passes the limit of bytes, without reading the rest.
 */
async function readStdin(): Promise<Uint8Array> {
  if (process.stdin.isTTY) {
    throw new TypeError(
      formatMessage(
        PREFIX,
        ['font `-`'],
        'reads stdin, which is a terminal. Pipe the font file in',
      ),
    )
  }
  const bytes = await readAtMost(process.stdin)
  if (bytes === undefined) {
    throw new TypeError(formatMessage(PREFIX, ['font bytes'], TOO_LARGE))
  }
  return bytes
}

function parseCategory(category: string | undefined): FontCategory | undefined {
  if (category !== undefined && !isFontCategory(category)) {
    throw new TypeError(
      formatMessage(
        PREFIX,
        ['`--category`'],
        `expected ${EXPECTED_CATEGORY}, received ${describeValue(category)}`,
      ),
    )
  }
  return category
}

/**
 * @throws TypeError if a name isn't a family name, or for `--name` a font-family name, with the
 *   option's own subject.
 */
function checkNames(option: '--fallback' | '--name', names: ReadonlyArray<string>): void {
  const [isValid, expected] =
    option === '--name'
      ? [isFontFaceName, EXPECTED_FONT_FACE_NAME]
      : [isFamilyName, EXPECTED_FAMILY_NAME]
  const invalid = names.find((name) => !isValid(name))
  if (invalid !== undefined) {
    throw new TypeError(
      formatMessage(
        PREFIX,
        [`\`${option}\``],
        `expected ${expected}, received ${describeValue(invalid)}`,
      ),
    )
  }
}

/**
 * @throws TypeError if a fallback repeats another in any case, as `getFontFallbacks` does, but
 *   naming the option.
 */
function checkRepeatedFallbacks(fallbacks: ReadonlyArray<string>): void {
  const seen = new Map<string, string>()
  for (const fallback of fallbacks) {
    const first = seen.get(getFamilyKey(fallback))
    if (first !== undefined) {
      throw new TypeError(
        formatMessage(
          PREFIX,
          ['`--fallback`'],
          `${formatNames([fallback])} repeats ${formatNames([first])}, as family names match in any case. Drop one`,
        ),
      )
    }
    seen.set(getFamilyKey(fallback), fallback)
  }
}

/**
 * Checks `--name` for a font file, URL or stdin, as `getFontFallbacks` does, but naming the options
 *
 * @throws TypeError if it's missing, or it isn't a family without `--category` or `--fallback`.
 */
async function checkFileName(name: string | undefined, hasFallbacks: boolean): Promise<void> {
  if (name === undefined) {
    throw new TypeError(
      formatMessage(
        PREFIX,
        ['`--name`'],
        'is required for a font file, URL or stdin. Pass the font-family name of your @font-face',
      ),
    )
  }
  if (!hasFallbacks && (await findFamily(name)) === undefined) {
    throw new TypeError(
      formatMessage(
        PREFIX,
        ['`--name`'],
        `${formatNames([name])} isn't a family in @capsizecss/metrics, so pass \`-c\`/\`--category\` or \`-f\`/\`--fallback\`${await getCaseHint(name)}`,
      ),
    )
  }
}

function isFontCategory(value: string): value is FontCategory {
  return Object.hasOwn(DEFAULT_FALLBACKS, value)
}

function formatTable(fallbacks: ReadonlyArray<FontFallback>): string {
  const rows = [
    ['Fallback', 'size-adjust', 'ascent', 'descent', 'line-gap'],
    ...fallbacks.map((fallback) => [
      escapeControls(fallback.fallbackFamily, { keepBackslashes: true }),
      toPercentage(fallback.sizeAdjust, 2),
      toPercentage(fallback.ascentOverride, 2),
      toPercentage(fallback.descentOverride, 2),
      toPercentage(fallback.lineGapOverride, 2),
    ]),
  ]
  const widths = rows.reduce<Array<number>>(
    (maxWidths, row) => row.map((cell, column) => Math.max(maxWidths[column] ?? 0, cell.length)),
    [],
  )
  return rows
    .map((row, index) => {
      const line = row
        .map((cell, column) => cell.padEnd(widths[column] ?? 0))
        .join('  ')
        .trimEnd()
      return index === 0 ? styleText('dim', line) : line
    })
    .join('\n')
}

/**
 * Control and format characters `JSON.stringify` leaves as they are, such as DEL, C1 controls and
 * bidi overrides. It escapes C0 controls in strings, so a newline is indentation
 */
const JSON_CONTROL_REGEX = /[[\p{Cc}\p{Cf}]--\n]/gv

/**
 * `value` as indented JSON with control and format characters as `\uXXXX` escapes, so no name can
 * rewrite the terminal. Names are checked before this, so it's defence in depth. `escapeControls`
 * isn't used, as it writes `\u{e0001}` above U+FFFF, which isn't JSON
 */
function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2).replaceAll(JSON_CONTROL_REGEX, (char) =>
    Array.from(
      { length: char.length },
      // eslint-disable-next-line unicorn/prefer-code-point -- JSON escapes UTF-16 code units
      (_, index) => String.raw`\u${char.charCodeAt(index).toString(16).padStart(4, '0')}`,
    ).join(''),
  )
}

function formatWindowsLineHeightNote(ratio: number): string {
  // Relative to the web font's lines, which are `ratio` times the fallbacks'
  const percentage = toPercentage(Math.abs(1 - 1 / ratio), 1)
  const comparison = ratio > 1 ? 'shorter' : 'taller'
  return `Note: the font's line height on Windows differs from its hhea one, which the overrides match, so there the fallbacks' lines are about ${percentage} ${comparison} than the web font's`
}

const ARGS_CONFIG = {
  allowPositionals: true,
  options: {
    category: { type: 'string', short: 'c' },
    fallback: { type: 'string', short: 'f', multiple: true },
    name: { type: 'string', short: 'n' },
    css: { type: 'boolean' },
    json: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean' },
  },
} as const satisfies ParseArgsConfig

/**
 * @throws If an argument is an unknown option, or an option lacks its value.
 */
function parseArguments(): ReturnType<typeof parseArgs<typeof ARGS_CONFIG>> {
  try {
    return parseArgs(ARGS_CONFIG)
  } catch (error) {
    // Node's message can span lines. Joining them first keeps `getErrorReason` from escaping the
    // line breaks
    const detail = getErrorReason(getErrorMessage(error).replaceAll('\n', ' '))
    throw new Error(
      formatMessage(
        PREFIX,
        ['arguments'],
        `failed to parse: ${detail}. Run font-fallback --help for the options`,
      ),
      { cause: error },
    )
  }
}

/**
 * What `main` found before it failed
 */
type Run = {
  /**
   * Whether the font is a local path or stdin, so an error's causes can be printed. A URL's causes
   * can hold its credentials or tokens
   */
  isLocalPath: boolean
}

async function main(run: Run): Promise<void> {
  const { values, positionals } = parseArguments()
  if (values.help === true) {
    process.stdout.write(`${HELP}\n`)
    return
  }
  if (values.version === true) {
    process.stdout.write(
      `${await readPackageVersion(PREFIX, new URL('../package.json', import.meta.url))}\n`,
    )
    return
  }
  const [font, ...rest] = positionals
  if (font === undefined) {
    process.stderr.write(`${HELP}\n`)
    process.exitCode = 1
    return
  }
  if (rest.length > 0) {
    // `parseArgs` reads every argument after `--` as a font
    const hint = rest.some((arg) => arg.startsWith('-')) ? '. Put options before `--`' : ''
    throw new Error(
      formatMessage(
        PREFIX,
        ['arguments'],
        `expected one font, received ${positionals.length} fonts${hint}`,
      ),
    )
  }
  if (values.css === true && values.json === true) {
    throw new Error(formatMessage(PREFIX, ['`--css` and `--json`'], CONFLICT_DESCRIPTION))
  }
  if (values.category !== undefined && values.fallback !== undefined) {
    throw new Error(formatMessage(PREFIX, ['`--category` and `--fallback`'], CONFLICT_DESCRIPTION))
  }

  checkNames('--fallback', values.fallback ?? [])
  checkNames('--name', values.name === undefined ? [] : [values.name])
  checkRepeatedFallbacks(values.fallback ?? [])
  const category = parseCategory(values.category)
  const hasFallbacks = category !== undefined || values.fallback !== undefined
  // `--name` is checked before stdin is read, which can take a while. Another source is checked
  // first, as `getFontFallbacks` does
  if (font === STDIN_ARG) {
    await checkFileName(values.name, hasFallbacks)
  }
  const source = await parseSource(font)
  // Set once the source is checked, as a `file:` URL with a host, user or password is rejected
  // there, and the causes of its rejection could hold them
  const kind = font === STDIN_ARG ? 'bytes' : checkSource(source).kind
  run.isLocalPath = typeof source !== 'string'
  if (font !== STDIN_ARG && kind !== 'family') {
    await checkFileName(values.name, hasFallbacks)
  }
  let result: FontFallbacks
  try {
    result = await getFontFallbacks(source, {
      category,
      fallbacks: values.fallback,
      name: values.name,
    })
  } catch (error) {
    const defaults = getDefaultFallbacksIssues(error)
    if (defaults === undefined) {
      throw error
    }
    // eslint-disable-next-line preserve-caught-error -- The library error wraps nothing, and as a cause it would print this message again with its own fix
    throw new Error(
      formatDefaultFallbacksMessage(defaults.subject, defaults.issues, 'Pass `-f`/`--fallback`'),
    )
  }
  const { css, fontFamily, fallbacks, windowsLineHeightRatio } = result
  if (values.css === true) {
    process.stdout.write(`${css}\n`)
    return
  }
  if (values.json === true) {
    process.stdout.write(`${toJson({ css, fontFamily, fallbacks, windowsLineHeightRatio })}\n`)
    return
  }
  process.stdout.write(
    [
      styleText('bold', 'font-family'),
      fontFamily,
      '',
      styleText('bold', 'Fallbacks'),
      formatTable(fallbacks),
      // Capsize's data for a family is measured at the font's default opsz
      ...(isReadAtOpticalSize(result)
        ? [
            `Note: the font's metrics are read at opsz ${OPTICAL_SIZE}, clamped to its opsz axis, so they can differ from those of its family name`,
          ]
        : []),
      ...(windowsLineHeightRatio === undefined
        ? []
        : [formatWindowsLineHeightNote(windowsLineHeightRatio)]),
      '',
      styleText('bold', 'CSS'),
      css,
      '',
    ].join('\n'),
  )
}

const run: Run = { isLocalPath: false }
try {
  await main(run)
} catch (error) {
  // Causes only for a local path, as a URL's can hold its credentials or tokens
  process.stderr.write(formatCliError(error, { causes: run.isLocalPath, stream: process.stderr }))
  process.exitCode = 1
}
