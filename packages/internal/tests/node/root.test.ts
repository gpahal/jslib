import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import { checkRoot } from '@/node/root'
import { withTmpProject } from '@/node/testing'

const PREFIX = '@scope/config'

test('rejects a relative path', () => {
  expect(() => {
    checkRoot(PREFIX, 'a/b')
  }).toThrow(
    new TypeError(
      `${PREFIX}: \`root\`: expected an absolute path, such as \`import.meta.dirname\`, received \`"a/b"\``,
    ),
  )
})

test("rejects a path that isn't a folder", async () => {
  await using project = await withTmpProject('internal-root', { 'package.json': '' })
  for (const root of [path.join(project.dir, 'missing'), path.join(project.dir, 'package.json')]) {
    expect(() => {
      checkRoot(PREFIX, root)
    }).toThrow(new TypeError(`${PREFIX}: \`root\`: path \`${root}\` isn't a folder`))
  }
})

test('wraps an error reading the path, with the error as the cause', async () => {
  await using project = await withTmpProject('internal-root')
  const root = path.join(project.dir, 'loop')
  await fs.symlink(root, root)
  expect(() => {
    checkRoot(PREFIX, root)
  }).toThrow(
    expect.objectContaining({
      message: expect.stringContaining(
        `${PREFIX}: \`root\`: reading \`${root}\` failed: `,
      ) as unknown,
      cause: expect.objectContaining({ code: 'ELOOP' }) as unknown,
    }),
  )
})

test.each([
  { access: 'read', denied: fsSync.constants.R_OK },
  { access: 'search', denied: fsSync.constants.X_OK },
])('rejects a folder without $access access, keeping the cause', async ({ denied }) => {
  await using project = await withTmpProject('internal-root')
  const cause = Object.assign(new Error('permission denied'), { code: 'EACCES' })
  const accessSync = fsSync.accessSync
  using _access = vi.spyOn(fsSync, 'accessSync').mockImplementation((file, mode) => {
    if (file === project.dir && ((mode ?? 0) & denied) !== 0) throw cause
    accessSync(file, mode)
  })
  expect(() => checkRoot(PREFIX, project.dir)).toThrow(
    expect.objectContaining({
      message: `${PREFIX}: \`root\`: reading \`${project.dir}\` failed: permission denied`,
      cause,
    }),
  )
})
