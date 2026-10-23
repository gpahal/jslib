import fs from 'node:fs'
import { builtinModules } from 'node:module'
import path from 'node:path'

const BUILD_DIR = path.join(import.meta.dirname, '..', 'build')

const SRC_DIR = path.join(import.meta.dirname, '..', 'src')

/**
 * The specifiers of a built module's static and dynamic imports and re-exports
 */
const IMPORT_REGEX = /\b(?:from|import)[\s(]*["'](?<specifier>[^"']+)["']/g

/**
 * The bare and `node:` specifiers that `file` imports, directly or through the build's own chunks
 */
function collectImports(file: string, seen = new Set<string>()): Set<string> {
  const imports = new Set<string>()
  if (seen.has(file)) {
    return imports
  }
  seen.add(file)
  for (const { groups } of fs.readFileSync(file, 'utf8').matchAll(IMPORT_REGEX)) {
    const specifier = groups?.['specifier'] ?? ''
    if (specifier.startsWith('.')) {
      const nested = collectImports(path.resolve(path.dirname(file), specifier), seen)
      for (const nestedSpecifier of nested) {
        imports.add(nestedSpecifier)
      }
    } else {
      imports.add(specifier)
    }
  }
  return imports
}

function isNodeModule(specifier: string): boolean {
  return specifier.startsWith('node:') || builtinModules.includes(specifier.split('/', 1)[0] ?? '')
}

// The modules outside `src/node/`, which builds to `build/node`, are for any package, browser-safe
// ones too. Listed from `src/`, so without a build `beforeAll` fails with its message
test.each(
  fs
    .readdirSync(SRC_DIR)
    .filter((file) => file.endsWith('.ts'))
    .map((file) => file.replace(/\.ts$/u, '.js')),
)('the browser module %s imports no Node module, directly or through a chunk', (file) => {
  const nodeImports = [...collectImports(path.join(BUILD_DIR, file))].filter((specifier) =>
    isNodeModule(specifier),
  )
  expect(nodeImports).toEqual([])
})
