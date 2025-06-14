import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkLintCheckboxCharacterStyle from 'remark-lint-checkbox-character-style'
import remarkLintFileExtension from 'remark-lint-file-extension'
import remarkLintListItemIndent from 'remark-lint-list-item-indent'
import remarkLintMaximumHeadingLength from 'remark-lint-maximum-heading-length'
import remarkLintMaximumLineLength from 'remark-lint-maximum-line-length'
import remarkLintMdxJsxNoVoidChildren from 'remark-lint-mdx-jsx-no-void-children'
import remarkLintMdxJsxQuoteStyle from 'remark-lint-mdx-jsx-quote-style'
import remarkLintMdxJsxSelfClose from 'remark-lint-mdx-jsx-self-close'
import remarkLintMdxJsxUniqueAttributeName from 'remark-lint-mdx-jsx-unique-attribute-name'
import remarkLintNoHeadingPunctuation from 'remark-lint-no-heading-punctuation'
import remarkLintNoUndefinedReferences from 'remark-lint-no-undefined-references'
import remarkMath from 'remark-math'
import remarkMdx from 'remark-mdx'
import remarkPresetLintConsistent from 'remark-preset-lint-consistent'
import remarkPresetLintMarkdownStyleGuide from 'remark-preset-lint-markdown-style-guide'
import remarkPresetLintRecommended from 'remark-preset-lint-recommended'

const remarkPresetLintMd: {
  settings: Record<string, unknown>
  plugins: Array<unknown>
} = {
  settings: {
    bullet: '-',
    bulletOther: '*',
    bulletOrdered: '.',
    closeAtx: false,
    emphasis: '*',
    fence: '`',
    fences: true,
    incrementListMarker: true,
    listItemIndent: 'one',
    quote: '"',
    resourceLink: true,
    rule: '-',
    ruleRepetition: 3,
    ruleSpaces: false,
    setext: false,
    strong: '*',
    style: 'consistent',
    tightDefinitions: false,
  },
  plugins: [
    remarkGfm,
    remarkMath,
    remarkFrontmatter,
    remarkMdx,
    remarkPresetLintRecommended,
    remarkPresetLintConsistent,
    remarkPresetLintMarkdownStyleGuide,
    [remarkLintFileExtension, ['md', 'mdx']],
    [remarkLintMaximumHeadingLength, [1, 100]],
    [remarkLintMaximumLineLength, 100],
    [remarkLintNoHeadingPunctuation, ':'],
    [remarkLintListItemIndent, 'one'],
    [remarkLintCheckboxCharacterStyle, { checked: 'x', unchecked: ' ' }],
    [
      remarkLintNoUndefinedReferences,
      { allow: ['!NOTE', '!TIP', '!IMPORTANT', '!WARNING', '!CAUTION', ' ', 'x'] },
    ],
    remarkLintMdxJsxNoVoidChildren,
    remarkLintMdxJsxSelfClose,
    [remarkLintMdxJsxQuoteStyle, '"'],
    remarkLintMdxJsxUniqueAttributeName,
  ],
}

export default remarkPresetLintMd
