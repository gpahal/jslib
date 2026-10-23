import fs from 'node:fs/promises'
import path from 'node:path'

import { runNodeOk, withTmpProject, writeFiles } from '@gpahal/internal/node/testing'

/**
 * What typescript-eslint's parser gives `dir/file` in a process of its own, with
 * `allowDefaultProject: [file]` and `dir` as the root: `parsed`, or the error message. Each of the
 * folders `a`, `b` and `c` has a tsconfig of `src`, and `link` links to `a`. Except for `c`, a
 * parse of `a/a.config.ts` comes first, so the project service already exists. In a process of
 * its own, since typescript-eslint's project service lives as long as the process
 */
export async function parseWithProjectService(dir: string, file: string): Promise<string> {
  await using project = await withTmpProject('eslint-config-project-service')
  const tsconfig = '{ "include": ["src"] }\n'
  await writeFiles(project.dir, {
    'a/tsconfig.json': tsconfig,
    'a/a.config.ts': 'export default {}\n',
    'b/tsconfig.json': tsconfig,
    'b/b.config.ts': 'export default {}\n',
    'c/tsconfig.json': tsconfig,
    'c/src/index.ts': "export { default } from '../c.config.js'\n",
    'c/c.config.ts': 'export default {}\n',
  })
  await fs.symlink(path.join(project.dir, 'a'), path.join(project.dir, 'link'))
  const script = String.raw`
const { parser } = await import('typescript-eslint')
const parse = (root, globs, file) => {
  try {
    parser.parseForESLint('export default {}\n', {
      filePath: file,
      tsconfigRootDir: root,
      projectService: { allowDefaultProject: globs },
    })
    return 'parsed'
  } catch (error) {
    return error.message
  }
}
const { DIR: dir, ROOT: name, FILE: file } = process.env
if (name !== 'c') {
  parse(dir + '/a', ['a.config.ts'], dir + '/a/a.config.ts')
}
const root = name === 'link' ? dir + '/a' : dir + '/' + name
console.log(parse(root, [file], dir + '/' + name + '/' + file))
`
  // Awaited, so the project outlives the process
  return await runNodeOk(['--input-type=module', '--eval', script], {
    cwd: path.join(import.meta.dirname, '..'),
    env: { DIR: project.dir, ROOT: dir, FILE: file },
  })
}
