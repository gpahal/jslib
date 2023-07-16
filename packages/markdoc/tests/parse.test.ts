import * as React from 'react'

import {
  getRenderableTreeNodeIdsMap,
  getRenderableTreeNodeTopLevelSections,
  linkSchema,
  parse,
  renderReact,
} from '@/index'

const mdocContent = `\
---
label1: value1
label2: value2
---

C1

{% link href="link1" attr1="value1" %}label1{% /link %}

[label2](link2)

\`\`\`ts
const a = 5
\`\`\`

## [H2a](H2alink)

C2

### H3a

C3

#### H4a

C4

#### H4b

C5

### H3b

C6

## H2b

C6

### H3c

C7

### H3d

C8

#### H4c

C9
`

test('parse', async () => {
  const result = await parse(mdocContent, {
    transformConfig: {
      tags: {
        link: {
          ...linkSchema,
          attributes: {
            ...linkSchema.attributes,
            attr1: { type: String },
          },
        },
      },
    },
  })
  expect(result).toBeTruthy()
  expect(result.isSuccessful).toBe(true)

  assert(result.isSuccessful === true)

  expect(result.content).toBeTruthy()
  expect(result.frontmatter).toBeTruthy()
  expect(result.frontmatter.label1).toBe('value1')
  expect(result.frontmatter.label2).toBe('value2')
  expect(result.headingNodes).toBeTruthy()
  expect(result.headingNodes.length).toBe(2)
  expect(result.headingNodes[0]!.children.length).toBe(2)
  expect(result.readTimeResults).toBeTruthy()

  const rendered = renderReact(React, result.content)
  expect(rendered).toBeTruthy()

  const idsMap = getRenderableTreeNodeIdsMap(result.content)
  expect(idsMap).toBeTruthy()
  expect(idsMap.size).toBe(9)

  const topLevelSections = getRenderableTreeNodeTopLevelSections(result.content)
  expect(topLevelSections).toBeTruthy()
  expect(topLevelSections.nodes.length).toBe(4)
  expect(topLevelSections.sections.length).toBe(2)
})
