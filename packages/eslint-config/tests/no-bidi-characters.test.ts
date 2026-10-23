import { RuleTester } from 'eslint'

import { GPAHAL_PLUGIN } from '@/internal/plugin'

import { CORE_AREAS_OFF, createESLint, lint, withProject } from './helpers'

const RULE = '@gpahal/no-bidi-characters'

const RLO = '\u{202E}'
const LRI = '\u{2066}'
const PDI = '\u{2069}'

new RuleTester().run('no-bidi-characters', GPAHAL_PLUGIN.rules['no-bidi-characters'], {
  valid: [
    // Right-to-left letters and the implicit marks reorder nothing on their own
    "const greeting = 'שלום עולם'",
    "const mark = 'a\u{200F}b'",
    // An escape is visible
    String.raw`const rlo = '\u202E'`,
  ],
  invalid: [
    {
      // The Trojan Source example of CVE-2021-42574
      code: `/*${RLO} } ${LRI}if (isAdmin)${PDI} ${LRI} begin admins only */`,
      errors: [
        {
          messageId: 'bidiCharacter',
          data: { codePoint: 'U+202E', name: 'RIGHT-TO-LEFT OVERRIDE', hex: '202E' },
          line: 1,
          column: 3,
          endColumn: 4,
        },
        { messageId: 'bidiCharacter', column: 7 },
        { messageId: 'bidiCharacter', column: 20 },
        { messageId: 'bidiCharacter', column: 22 },
      ],
    },
  ],
})

test('reports each bidi control once in every language the config lints, off with `javascript.rules`', async () => {
  await using project = await withProject({
    'package.json': `{ "private": true, "type": "module", "description": "a${RLO}" }\n`,
    'src/a.js': `// ${RLO}\nexport const a = 1\n`,
    'data.json': `{ "a": "${RLO}" }\n`,
    'data.yaml': `a: "${RLO}"\n`,
    'data.toml': `a = "${RLO}"\n`,
    'README.md': `# Title\n\nText ${RLO} here.\n\n\`\`\`ts\nexport const b = '${LRI}'\n\`\`\`\n`,
    'index.html': `<!doctype html>\n<html lang="en">\n  <head>\n    <title>${RLO}</title>\n  </head>\n</html>\n`,
    'src/page.astro': `---\nconsole.warn('${RLO}')\n---\n\n<p>Text</p>\n\n<script>\n  console.warn('${PDI}')\n</script>\n`,
  })
  // Only the rule runs, in each language's configs
  const options = { ...CORE_AREAS_OFF, markdown: true, typeAware: false, html: true, astro: true }
  const ruleFilter = ({ ruleId }: { ruleId: string }) => ruleId === RULE
  const eslint = await createESLint(project.dir, options, { ruleFilter })
  const results = await lint(eslint, ['.'])
  expect(
    Object.fromEntries(
      Object.entries(results).map(([file, messages]) => [
        file,
        messages.filter((message) => message.startsWith(`${RULE}:`)).length,
      ]),
    ),
  ).toMatchObject({
    'package.json': 1,
    'src/a.js': 1,
    'data.json': 1,
    'data.yaml': 1,
    'data.toml': 1,
    'README.md': 2,
    'index.html': 1,
    'src/page.astro': 2,
  })
  const off = await createESLint(
    project.dir,
    { ...options, javascript: { rules: { [RULE]: 'off' } } },
    { ruleFilter },
  )
  const offResults = await lint(off, ['.'])
  expect(
    Object.values(offResults)
      .flat()
      .filter((message) => message.startsWith(`${RULE}:`)),
  ).toEqual([])
})
