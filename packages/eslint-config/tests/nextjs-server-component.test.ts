import { RuleTester } from 'eslint'
import { parser as tsEslintParser } from 'typescript-eslint'

import { GPAHAL_PLUGIN } from '@/internal/plugin'

import { collator, createESLint, lint, withProject } from './helpers'

const RULE = '@gpahal/nextjs-server-component'

const tester = new RuleTester({
  languageOptions: {
    parser: tsEslintParser,
    parserOptions: { ecmaFeatures: { jsx: true } },
    globals: { window: 'readonly', document: 'readonly', localStorage: 'readonly' },
  },
})

const ROUTE = "export function GET() {\n  return Response.json(localStorage.getItem('a'))\n}\n"

tester.run('nextjs-server-component', GPAHAL_PLUGIN.rules['nextjs-server-component'], {
  valid: [
    {
      filename: 'app/page.tsx',
      code: "'use client'\n\nimport { useState } from 'react'\n\nexport default function Page() {\n  const [n] = useState(window.innerWidth)\n  return <p>{n}</p>\n}\n",
    },
    // `typeof` reads nothing on the server, and a type names no value
    {
      filename: 'app/layout.tsx',
      code: "export const isBrowser = typeof window !== 'undefined'\nexport type W = typeof window\n",
    },
    // A file of the `server` option, where `@gpahal/no-browser-globals` reports them
    { filename: 'app/api/route.ts', code: ROUTE, options: [{ ignoresBrowserGlobals: true }] },
    { filename: 'app/nav.tsx', code: 'export const width = window.innerWidth\n' },
    // `typeof` of a `globalThis` property, a property Node has, and a local `globalThis`
    {
      filename: 'app/page.tsx',
      code: "export const isBrowser = typeof globalThis.window !== 'undefined' && typeof globalThis?.['document'] === 'object'\nexport const f = globalThis.fetch\nexport function title(globalThis: { document: { title: string } }) {\n  return globalThis.document.title\n}\n",
    },
  ],
  invalid: [
    {
      filename: 'app/page.tsx',
      code: "import React, { useEffect } from 'react'\n\nexport default function Page() {\n  const ref = React.useRef(null)\n  useEffect(() => {\n    document.title = 'a'\n  })\n  return <p ref={ref} />\n}\n",
      errors: [
        { messageId: 'clientHook', data: { name: 'useRef' }, line: 4 },
        { messageId: 'clientHook', data: { name: 'useEffect' }, line: 5 },
        { messageId: 'browserGlobal', data: { name: 'document' }, line: 6 },
      ],
    },
    {
      filename: 'app/page.tsx',
      code: "export default function Page() {\n  return <p>{globalThis.window.innerWidth}{(globalThis as any)['document'].title}</p>\n}\nexport const store = globalThis.localStorage\n",
      errors: [
        { messageId: 'browserGlobal', data: { name: 'globalThis.window' }, line: 2 },
        { messageId: 'browserGlobal', data: { name: 'globalThis.document' }, line: 2 },
        { messageId: 'browserGlobal', data: { name: 'globalThis.localStorage' }, line: 4 },
      ],
    },
    // Next's client-only hooks
    {
      filename: 'app/page.tsx',
      code: "import { usePathname, useRouter, useSearchParams } from 'next/navigation'\n\nexport default function Page() {\n  const pathname = usePathname()\n  const router = useRouter()\n  const params = useSearchParams()\n  return <p>{pathname}{router ? params.size : 0}</p>\n}\n",
      errors: [
        { messageId: 'clientHook', data: { name: 'usePathname' }, line: 4 },
        { messageId: 'clientHook', data: { name: 'useRouter' }, line: 5 },
        { messageId: 'clientHook', data: { name: 'useSearchParams' }, line: 6 },
      ],
    },
    {
      filename: 'app/api/route.ts',
      code: ROUTE,
      errors: [{ messageId: 'routeBrowserGlobal', data: { name: 'localStorage' } }],
    },
    {
      filename: 'app/global-error.jsx',
      code: "'use strict'\nexport default function GlobalError() {\n  return null\n}\n",
      errors: [{ messageId: 'missingUseClient', data: { file: 'global-error' } }],
    },
  ],
})

test('checks the route entry files of the app folders of each `nextjs.rootDir`', async () => {
  const page = 'export default function Page() {\n  return <p>{window.innerWidth}</p>\n}\n'
  await using project = await withProject({
    'package.json': '{ "name": "a", "private": true, "type": "module" }\n',
    'apps/web/app/page.tsx': page,
    'apps/web/app/(shop)/cart/template.jsx': page,
    'apps/web/app/nav.tsx': page,
    'apps/docs/src/app/loading.tsx': page,
    'app/page.tsx': page,
  })
  const eslint = await createESLint(project.dir, {
    typeAware: false,
    nextjs: { rootDir: ['apps/web', 'apps/docs'] },
  })
  const results = await lint(eslint, ['.'])
  expect(
    Object.entries(results)
      .filter(([, messages]) => messages.some((message) => message.startsWith(`${RULE}:`)))
      .map(([file]) => file)
      .toSorted((a, b) => collator.compare(a, b)),
  ).toEqual([
    'apps/docs/src/app/loading.tsx',
    'apps/web/app/(shop)/cart/template.jsx',
    'apps/web/app/page.tsx',
  ])
})

test('leaves browser globals in the `server` files to `@gpahal/no-browser-globals`', async () => {
  await using project = await withProject({
    'package.json': '{ "name": "a", "private": true, "type": "module" }\n',
    'app/page.tsx':
      "import { useState } from 'react'\n\nexport default function Page() {\n  const [n] = useState(window.innerWidth)\n  return <p>{n}</p>\n}\n",
  })
  const eslint = await createESLint(project.dir, {
    typeAware: false,
    nextjs: true,
    server: { files: ['app/**'] },
  })
  const messages = (await lint(eslint, ['app/page.tsx']))['app/page.tsx'] ?? []
  expect(
    messages.filter((message) => /^@gpahal\/(?:nextjs-server-component|no-browser)/u.test(message)),
  ).toEqual([
    expect.stringMatching(/^@gpahal\/nextjs-server-component: Unexpected `useState\(\)`/u),
    expect.stringMatching(/^@gpahal\/no-browser-globals: Unexpected use of 'window'/u),
  ])
})
