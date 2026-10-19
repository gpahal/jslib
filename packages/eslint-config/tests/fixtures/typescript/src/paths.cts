// Under `verbatimModuleSyntax`, a `.cts` file is CommonJS and must use `import = require` and
// `export =`
import path = require('node:path')

function resolveFromHere(file: string): string {
  return path.join(__dirname, file)
}

export = { resolveFromHere }
