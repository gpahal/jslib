import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkLint from 'remark-lint'
import remarkLintBlockquoteIndentation from 'remark-lint-blockquote-indentation'
import remarkLintCheckboxCharacterStyle from 'remark-lint-checkbox-character-style'
import remarkLintCodeBlockStyle from 'remark-lint-code-block-style'
import remarkLintDefinitionCase from 'remark-lint-definition-case'
import remarkLintDefinitionSpacing from 'remark-lint-definition-spacing'
import remarkLintEmphasisMarker from 'remark-lint-emphasis-marker'
import remarkLintFencedCodeFlag from 'remark-lint-fenced-code-flag'
import remarkLintFencedCodeMarker from 'remark-lint-fenced-code-marker'
import remarkLintFileExtension from 'remark-lint-file-extension'
import remarkLintFinalDefinition from 'remark-lint-final-definition'
import remarkLintFinalNewline from 'remark-lint-final-newline'
import remarkLintHardBreakSpaces from 'remark-lint-hard-break-spaces'
import remarkLintHeadingIncrement from 'remark-lint-heading-increment'
import remarkLintHeadingStyle from 'remark-lint-heading-style'
import remarkLintLinkTitleStyle from 'remark-lint-link-title-style'
import remarkLintListItemBulletIndent from 'remark-lint-list-item-bullet-indent'
import remarkLintListItemContentIndent from 'remark-lint-list-item-content-indent'
import remarkLintListItemIndent from 'remark-lint-list-item-indent'
import remarkLintListItemSpacing from 'remark-lint-list-item-spacing'
import remarkLintMaximumHeadingLength from 'remark-lint-maximum-heading-length'
import remarkLintMaximumLineLength from 'remark-lint-maximum-line-length'
import remarkLintMdxJsxNoVoidChildren from 'remark-lint-mdx-jsx-no-void-children'
import remarkLintMdxJsxQuoteStyle from 'remark-lint-mdx-jsx-quote-style'
import remarkLintMdxJsxSelfClose from 'remark-lint-mdx-jsx-self-close'
import remarkLintMdxJsxUniqueAttributeName from 'remark-lint-mdx-jsx-unique-attribute-name'
import remarkLintNoBlockquoteWithoutMarker from 'remark-lint-no-blockquote-without-marker'
import remarkLintNoConsecutiveBlankLines from 'remark-lint-no-consecutive-blank-lines'
import remarkLintNoDuplicateDefinitions from 'remark-lint-no-duplicate-definitions'
import remarkLintNoDuplicateHeadings from 'remark-lint-no-duplicate-headings'
import remarkLintNoEmphasisAsHeading from 'remark-lint-no-emphasis-as-heading'
import remarkLintNoFileNameArticles from 'remark-lint-no-file-name-articles'
import remarkLintNoFileNameConsecutiveDashes from 'remark-lint-no-file-name-consecutive-dashes'
import remarkLintNoFileNameIrregularCharacters from 'remark-lint-no-file-name-irregular-characters'
import remarkLintNoFileNameMixedCase from 'remark-lint-no-file-name-mixed-case'
import remarkLintNoFileNameOuterDashes from 'remark-lint-no-file-name-outer-dashes'
import remarkLintNoHeadingContentIndent from 'remark-lint-no-heading-content-indent'
import remarkLintNoHeadingPunctuation from 'remark-lint-no-heading-punctuation'
import remarkLintNoLiteralUrls from 'remark-lint-no-literal-urls'
import remarkLintNoMultipleToplevelHeadings from 'remark-lint-no-multiple-toplevel-headings'
import remarkLintNoShellDollars from 'remark-lint-no-shell-dollars'
import remarkLintNoShortcutReferenceImage from 'remark-lint-no-shortcut-reference-image'
import remarkLintNoShortcutReferenceLink from 'remark-lint-no-shortcut-reference-link'
import remarkLintNoTableIndentation from 'remark-lint-no-table-indentation'
import remarkLintNoUndefinedReferences from 'remark-lint-no-undefined-references'
import remarkLintNoUnusedDefinitions from 'remark-lint-no-unused-definitions'
import remarkLintOrderedListMarkerStyle from 'remark-lint-ordered-list-marker-style'
import remarkLintOrderedListMarkerValue from 'remark-lint-ordered-list-marker-value'
import remarkLintRuleStyle from 'remark-lint-rule-style'
import remarkLintStrongMarker from 'remark-lint-strong-marker'
import remarkLintTableCellPadding from 'remark-lint-table-cell-padding'
import remarkLintTablePipeAlignment from 'remark-lint-table-pipe-alignment'
import remarkLintTablePipes from 'remark-lint-table-pipes'
import remarkLintUnorderedListMarkerStyle from 'remark-lint-unordered-list-marker-style'
import remarkMath from 'remark-math'
import remarkMdx from 'remark-mdx'

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
    remarkLint,

    // https://cirosantilli.com/markdown-style-guide/#file-extension modified
    [remarkLintFileExtension, ['md', 'mdx']],

    // https://cirosantilli.com/markdown-style-guide/#file-name
    remarkLintNoFileNameMixedCase,
    remarkLintNoFileNameArticles,
    remarkLintNoFileNameIrregularCharacters,
    remarkLintNoFileNameConsecutiveDashes,
    remarkLintNoFileNameOuterDashes,

    // https://cirosantilli.com/markdown-style-guide/#newlines
    // https://cirosantilli.com/markdown-style-guide/#empty-lines-around-lists
    // https://cirosantilli.com/markdown-style-guide/#tables
    remarkLintNoConsecutiveBlankLines,

    // https://cirosantilli.com/markdown-style-guide/#line-wrapping modified
    [remarkLintMaximumLineLength, 120],

    // https://cirosantilli.com/markdown-style-guide/#dollar-signs-in-shell-code
    remarkLintNoShellDollars,

    // https://cirosantilli.com/markdown-style-guide/#line-breaks
    remarkLintHardBreakSpaces,

    // https://cirosantilli.com/markdown-style-guide/#headers
    [remarkLintHeadingStyle, 'atx'],
    remarkLintHeadingIncrement,
    remarkLintNoDuplicateHeadings,

    // https://cirosantilli.com/markdown-style-guide/#top-level-header
    remarkLintNoMultipleToplevelHeadings,

    // https://cirosantilli.com/markdown-style-guide/#header-length
    remarkLintMaximumHeadingLength,

    // https://cirosantilli.com/markdown-style-guide/#punctuation-at-the-end-of-headers
    [remarkLintNoHeadingPunctuation, ':'],

    // https://cirosantilli.com/markdown-style-guide/#blockquotes
    [remarkLintBlockquoteIndentation, 2],
    remarkLintNoBlockquoteWithoutMarker,

    // https://cirosantilli.com/markdown-style-guide/#unordered
    [remarkLintUnorderedListMarkerStyle, '-'],

    // https://cirosantilli.com/markdown-style-guide/#ordered
    [remarkLintOrderedListMarkerStyle, '.'],
    [remarkLintOrderedListMarkerValue, 'one'],

    // https://cirosantilli.com/markdown-style-guide/#spaces-after-list-marker modified
    [remarkLintListItemIndent, 'one'],

    // https://cirosantilli.com/markdown-style-guide/#indentation-of-content-inside-lists
    remarkLintListItemContentIndent,

    // https://cirosantilli.com/markdown-style-guide/#empty-lines-inside-lists
    remarkLintListItemSpacing,

    // https://cirosantilli.com/markdown-style-guide/#case-of-first-letter-of-list-item
    // Not checked.

    // https://cirosantilli.com/markdown-style-guide/#punctuation-at-the-end-of-list-items
    // Not checked.

    // https://cirosantilli.com/markdown-style-guide/#definition-lists
    // Not checked.

    // https://cirosantilli.com/markdown-style-guide/#code-blocks
    [remarkLintCodeBlockStyle, 'fenced'],
    [remarkLintFencedCodeFlag, { allowEmpty: false }],
    [remarkLintFencedCodeMarker, '`'],

    // https://cirosantilli.com/markdown-style-guide/#horizontal-rules
    [remarkLintRuleStyle, '---'],

    // https://cirosantilli.com/markdown-style-guide/#tables
    remarkLintNoTableIndentation,
    remarkLintTablePipes,
    remarkLintTablePipeAlignment,
    [remarkLintTableCellPadding, 'padded'],

    // https://cirosantilli.com/markdown-style-guide/#reference-style-links
    remarkLintNoShortcutReferenceImage,
    remarkLintNoShortcutReferenceLink,
    remarkLintFinalDefinition,
    remarkLintDefinitionCase,
    remarkLintDefinitionSpacing,

    // https://cirosantilli.com/markdown-style-guide/#single-or-double-quote-titles
    [remarkLintLinkTitleStyle, '"'],

    // https://cirosantilli.com/markdown-style-guide/#bold
    [remarkLintStrongMarker, '*'],

    // https://cirosantilli.com/markdown-style-guide/#italic
    [remarkLintEmphasisMarker, '*'],

    // https://cirosantilli.com/markdown-style-guide/#emphasis-vs-headers
    remarkLintNoEmphasisAsHeading,

    // https://cirosantilli.com/markdown-style-guide/#automatic-links-without-angle-brackets
    remarkLintNoLiteralUrls,

    // Recommended: https://github.com/remarkjs/remark-lint/tree/main/packages/remark-preset-lint-recommended
    remarkLintFinalNewline,
    remarkLintListItemBulletIndent,
    remarkLintNoDuplicateDefinitions,
    remarkLintNoHeadingContentIndent,
    remarkLintNoUndefinedReferences,
    remarkLintNoUnusedDefinitions,
    [remarkLintCheckboxCharacterStyle, { checked: 'x', unchecked: ' ' }],
    remarkLintMdxJsxNoVoidChildren,
    remarkLintMdxJsxSelfClose,
    [remarkLintMdxJsxQuoteStyle, '"'],
    remarkLintMdxJsxUniqueAttributeName,
  ],
}

export default remarkPresetLintMd
