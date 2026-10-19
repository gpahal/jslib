import process from 'node:process'

/**
 * Passed in by tests
 */
export type EditorEnv = {
  env: Record<string, string | undefined>
  argv: ReadonlyArray<string>
  isTTY?: boolean | undefined
}

/**
 * `eslint/bin/eslint.js`, or a package manager's `node_modules/.bin/eslint` shim when that's a Node
 * script. Its `--concurrency` workers run `eslint/lib/eslint/worker.js`, with no TTY
 */
const ESLINT_BIN_PATTERN =
  /(?:^|[\\/])(?:eslint[\\/]bin[\\/]eslint\.js|\.bin[\\/]eslint|eslint[\\/]lib[\\/]eslint[\\/]worker\.js)$/

export function isInEditorEnvOf({ env, argv, isTTY = false }: EditorEnv): boolean {
  // An empty variable, as a parent process sets to clear one, counts as unset
  const isSet = (name: string) => (env[name] ?? '') !== ''
  const isInTerminal =
    isTTY ||
    ['CI', 'GIT_PARAMS', 'VSCODE_GIT_COMMAND', 'npm_lifecycle_event'].some(isSet) ||
    ESLINT_BIN_PATTERN.test(argv[1] ?? '')
  const isInEditor =
    ['VSCODE_PID', 'VSCODE_CWD', 'JETBRAINS_IDE', 'VIM', 'NVIM', 'INSIDE_EMACS'].some(isSet) ||
    (isSet('ZED_ENVIRONMENT') && !isSet('ZED_TERM'))
  return !isInTerminal && isInEditor
}

/**
 * In an editor, an autofix on save would delete code being written. Terminals, including an
 * editor's, ESLint's command line, piped or not, package scripts, git hooks and CI aren't editors.
 * Editors that set none of the variables, such as Helix, need `isInEditor` set
 */
export function isInEditorEnv(): boolean {
  return isInEditorEnvOf({
    env: process.env,
    argv: process.argv,
    isTTY: process.stdout.isTTY,
  })
}
