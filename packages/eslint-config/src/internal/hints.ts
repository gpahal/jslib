import fs from 'node:fs'
import path from 'node:path'

import { formatNames } from '@gpahal/std/errors'
import { trimEnd } from '@gpahal/std/strings'

import { AREAS } from '@/internal/areas'
import { createGlobMatcher, splitGlobs, withoutLeadingDotSlash } from '@/internal/globs'
import { findListingManifest, getListedPackages, type ProjectManifest } from '@/internal/manifests'
import type { AreaName } from '@/internal/names'
import { formatPeersInstallCommand, isInstalledIn } from '@/internal/peers'
import type { EslintConfigOptions } from '@/internal/types'
import { formatErrorMessage, warnOfSetupOnce, type GpahalWarningCode } from '@/internal/utils'

/**
 * As `<root>\0<option>`, so each warns once per process, as editors reload the config
 */
const givenHints = new Set<string>()

function hint(root: string, option: string, description: string, code: GpahalWarningCode): void {
  const key = `${root}\0${option}`
  if (givenHints.has(key)) {
    return
  }
  warnOfSetupOnce(
    givenHints,
    key,
    formatErrorMessage([option === '' ? '`root`' : `\`${option}\``], description),
    code,
  )
}

/**
 * By the package a project installs for it
 */
const FRAMEWORK_OPTIONS: ReadonlyArray<[packageName: string, option: AreaName]> = [
  ['next', 'nextjs'],
  ['react', 'react'],
  ['astro', 'astro'],
  ['tailwindcss', 'tailwindcss'],
  ['turbo', 'turbo'],
  ['vitest', 'vitest'],
  ['@playwright/test', 'playwright'],
  ['storybook', 'storybook'],
]

/**
 * With the command that installs the plugins that don't resolve from `root`, if any
 */
function describeFrameworkHint(
  options: EslintConfigOptions,
  root: string,
  file: string,
  packageName: string,
  option: AreaName,
): string {
  const { peers = [] } = AREAS[option]
  const plugins = typeof peers === 'function' ? peers(options) : peers
  const missing = plugins.filter((plugin) => !isInstalledIn(plugin, root))
  const turnOn =
    option === 'tailwindcss'
      ? "`tailwindcss: { entryPoint: 'src/styles.css' }`, with your Tailwind CSS entry stylesheet"
      : `\`${option}: true\``
  // After the stylesheet's clause, a comma keeps the install from reading as part of it
  const install =
    missing.length === 0
      ? ''
      : `${option === 'tailwindcss' ? ',' : ''} and install its plugins, as in \`${formatPeersInstallCommand(missing, root)}\``
  return `\`${file}\` lists ${packageName}, but the \`${option}\` option isn't set, so its rules are off. Set ${turnOn}${install}, or set \`${option}: false\` to turn this warning off`
}

const TYPE_DEPENDENT_EXTNS: ReadonlyArray<string> = ['.js', '.jsx']

/**
 * `commonjs` for a CommonJS package with `.js` or `.jsx` files (`codeExtensions` is `undefined` when
 * unknown), and each listed framework's preset, unless another option turns it on, as `nextjs` does
 * `react`. A set option, even `false`, gives no hint
 */
export function warnOfOptionHints(
  options: EslintConfigOptions,
  root: string,
  isOn: Readonly<Record<AreaName, boolean>>,
  manifests: ReadonlyArray<ProjectManifest>,
  codeExtensions: ReadonlySet<string> | undefined,
): void {
  const rootManifest = manifests.find(({ file }) => file === 'package.json')?.manifest
  if (
    rootManifest !== undefined &&
    options.commonjs === undefined &&
    (codeExtensions === undefined ||
      TYPE_DEPENDENT_EXTNS.some((extension) => codeExtensions.has(extension)))
  ) {
    const type = rootManifest['type']
    if (type === 'commonjs' || type === undefined) {
      hint(
        root,
        'commonjs',
        `${type === undefined ? '`package.json` has no `"type"`, so Node runs `.js` files as CommonJS' : '`package.json` sets `"type": "commonjs"`, so Node runs `.js` files as CommonJS'}, but they're linted as ES modules. Set \`commonjs: true\`, or \`commonjs: false\` to lint them as ES modules${type === undefined ? ', or set `"type": "module"` in `package.json`' : ''}`,
        'GPAHAL_COMMONJS_PACKAGE',
      )
    }
  }
  const hinted = new Set<AreaName>()
  for (const [packageName, option] of FRAMEWORK_OPTIONS) {
    const isCovered = option === 'react' && hinted.has('nextjs')
    if (isCovered || isOn[option] || options[option] !== undefined) {
      continue
    }
    const listing = findListingManifest(manifests, packageName)
    if (listing === undefined) {
      continue
    }
    hinted.add(option)
    hint(
      root,
      option,
      describeFrameworkHint(options, root, listing.file, packageName, option),
      'GPAHAL_FRAMEWORK_OPTION_UNSET',
    )
  }
}

const REACT_COMPILER_PACKAGES: ReadonlyArray<string> = [
  'babel-plugin-react-compiler',
  'react-compiler-runtime',
]

export function usesReactCompiler(manifests: ReadonlyArray<ProjectManifest>): boolean {
  return manifests.some(({ manifest }) => {
    const listed = getListedPackages(manifest)
    return REACT_COMPILER_PACKAGES.some((packageName) => listed.has(packageName))
  })
}

const PLAYWRIGHT_CONFIG_FILES: ReadonlyArray<string> = ['ts', 'mts', 'cts', 'js', 'mjs', 'cjs'].map(
  (extension) => `playwright.config.${extension}`,
)

/**
 * As `npm init playwright` writes it
 */
const TEST_DIR_REGEX = /\btestDir\s*:\s*(['"`])([^'"`$\\]+)\1/

/**
 * The config is read as text, never run, so a computed `testDir` gives no warning
 */
export function warnOfPlaywrightTestDir(
  root: string,
  playwrightGlobs: ReadonlyArray<string>,
): void {
  if (playwrightGlobs.length === 0) {
    return
  }
  for (const name of PLAYWRIGHT_CONFIG_FILES) {
    let text: string
    try {
      const file = path.join(root, name)
      if (fs.statSync(file, { throwIfNoEntry: false })?.isFile() !== true) {
        continue
      }
      text = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const testDir = TEST_DIR_REGEX.exec(text)?.[2]
    if (testDir === undefined || path.isAbsolute(testDir)) {
      return
    }
    const dir = trimEnd(path.posix.normalize(testDir.replaceAll('\\', '/')), '/')
    if (dir === '..' || dir.startsWith('../')) {
      return
    }
    const example = dir === '.' ? 'example.spec.ts' : `${dir}/example.spec.ts`
    const { positive, negated } = splitGlobs(playwrightGlobs.map(withoutLeadingDotSlash))
    if (createGlobMatcher(positive)(example) && !createGlobMatcher(negated)(example)) {
      return
    }
    const suggested = dir === '.' ? '**/*.spec.ts' : `${dir}/**`
    hint(
      root,
      'playwright.files',
      `\`${name}\` sets \`testDir\` to ${formatNames([testDir])}, but \`playwright.files\` doesn't match its tests, such as ${formatNames([example])}, so they get no Playwright rules. Set \`playwright: { files: [${JSON.stringify(suggested).replaceAll('"', "'")}] }\``,
      'GPAHAL_PLAYWRIGHT_FILES_UNMATCHED',
    )
    return
  }
}
