import { Tag as MarkdocTag, type Schema } from '@markdoc/markdoc'
import { sha1 } from 'object-hash'
import {
  bundledLanguages,
  FontStyle,
  getSingletonHighlighter,
  type BundledLanguage,
  type BundledTheme,
  type Highlighter,
  type ThemedToken,
} from 'shiki'

import { isArray } from '@gpahal/std/arrays'
import { isString } from '@gpahal/std/strings'

export class Tag extends MarkdocTag {}

export function generateHeadingSchema(): Schema {
  return {
    children: ['inline'],
    attributes: {
      level: { type: Number, required: true, default: 1 },
      id: { type: String },
    },
    transform(node, config) {
      const children = node.transformChildren(config)
      const attributes = node.transformAttributes(config) as {
        level: number
        id?: string
      }

      const tagName = `h${attributes.level}`
      if (!attributes.id) {
        return new Tag(tagName, attributes, children)
      }

      return new Tag(tagName, attributes, [
        new Tag('a', { href: `#${attributes.id}`, class: `heading-anchor ${tagName}-anchor` }),
        ...children,
      ])
    },
  }
}

export type TransformedImageSrcWithSize = {
  src: string
  width?: number
  height?: number
}

export type TransformImageSrcAndGetSize = (
  src: string,
) => TransformedImageSrcWithSize | undefined | Promise<TransformedImageSrcWithSize | undefined>

export type ImageSchemaOptions = {
  transformImageSrcAndGetSize?: TransformImageSrcAndGetSize
}

export function generateImageSchema({ transformImageSrcAndGetSize }: ImageSchemaOptions = {}): Schema {
  return {
    attributes: {
      src: { type: String, required: true },
      alt: { type: String, required: true },
      title: { type: String },
    },
    async transform(node, config) {
      const attributes = node.transformAttributes(config) as {
        src: string
        alt: string
        title?: string
      }
      const {
        src = attributes.src,
        width = undefined,
        height = undefined,
      } = transformImageSrcAndGetSize ? (await transformImageSrcAndGetSize(attributes.src)) || {} : {}
      if (width == null || height == null) {
        return new Tag('img', { ...attributes, src: src || attributes.src })
      }

      return new Tag(
        'img',
        {
          width: String(width),
          height: String(height),
          ...attributes,
          src: src || attributes.src,
        },
        [],
      )
    },
  }
}

export const linkSchema: Schema = {
  render: 'a',
  children: ['strong', 'em', 's', 'code', 'text', 'tag', 'image'],
  attributes: {
    href: { type: String, required: true },
    title: { type: String },
  },
}

const GLOBAL_HIGHLIGHTERS_CACHE = new Map<
  string,
  Map<string, { themeName: BundledTheme; highlighter: Promise<Highlighter> }>
>()

export type FenceHighlightedLines = {
  from: number
  to?: number
}

export type CodeAndFenceSchemaConfig = {
  theme?: BundledTheme | Record<string, BundledTheme>
  wrapperTagName?: string
}

export function generateCodeAndFenceSchema({ theme, wrapperTagName }: CodeAndFenceSchemaConfig = {}): {
  code: Schema
  fence: Schema
} {
  theme = theme || 'github-light'
  wrapperTagName = wrapperTagName || 'div'
  const optionsHash = sha1({
    theme,
  })

  let highlightersCache = GLOBAL_HIGHLIGHTERS_CACHE.get(optionsHash)!
  if (!highlightersCache) {
    highlightersCache = new Map()
    GLOBAL_HIGHLIGHTERS_CACHE.set(optionsHash, highlightersCache)
  }

  if (!theme || isString(theme)) {
    if (!highlightersCache.has('default')) {
      highlightersCache.set('default', {
        themeName: theme,
        highlighter: getSingletonHighlighter({ themes: [theme], langs: Object.keys(bundledLanguages) }),
      })
    }
  } else if (typeof theme === 'object') {
    for (const [themeAlias, themeName] of Object.entries(theme)) {
      if (!highlightersCache.has(themeAlias)) {
        highlightersCache.set(themeAlias, {
          themeName,
          highlighter: getSingletonHighlighter({ themes: [themeName], langs: Object.keys(bundledLanguages) }),
        })
      }
    }
  }

  const highlighters = new Map<string, { themeName: BundledTheme; highlighter: Highlighter }>()

  const initializeHighlighters = async () => {
    for (const [themeAlias, { themeName, highlighter: highlighterPromise }] of highlightersCache.entries()) {
      if (!highlighters.has(themeAlias)) {
        highlighters.set(themeName, { themeName, highlighter: await highlighterPromise })
      }
    }
  }

  const code: Schema = {
    attributes: {
      content: { type: String, render: false, required: true },
    },
    async transform(node, _config) {
      await initializeHighlighters()

      const content = isString(node.attributes.content) ? node.attributes.content.trim() : ''
      const strippedContent = content.replace(/^{:[.A-Za-z-]+}/, '')
      const meta = /^{:([.A-Za-z-]+)}/.exec(content)?.[1] || ''
      const metaParts = meta.split('.', 2)

      const language = (metaParts[0]?.trim() || 'text') as BundledLanguage
      const tokenType = metaParts[1]?.trim() || ''

      const themeTags = [] as Array<Tag>
      for (const [themeAlias, { themeName, highlighter }] of highlighters.entries()) {
        let lines = [] as Array<Array<ThemedToken>>
        try {
          if (tokenType) {
            const settings:
              | {
                  readonly fontStyle?: string
                  readonly foreground?: string
                  readonly background?: string
                }
              | undefined = tokenType
              ? highlighter
                  .getTheme(themeName)
                  .settings.find(({ scope }: { scope?: string | Array<string> }) =>
                    scope ? (isString(scope) ? scope === tokenType : scope.includes(tokenType)) : false,
                  )?.settings
              : undefined
            lines = [
              [
                {
                  content: strippedContent,
                  offset: 0,
                  color: settings?.foreground || 'inherit',
                  bgColor: settings?.background,
                  fontStyle:
                    settings?.fontStyle === 'italic'
                      ? FontStyle.Italic
                      : settings?.fontStyle === 'bold'
                        ? FontStyle.Bold
                        : settings?.fontStyle === 'underline'
                          ? FontStyle.Underline
                          : undefined,
                },
              ],
            ]
          } else {
            lines = highlighter.codeToTokensBase(strippedContent, { theme: themeName, lang: language })
          }
        } catch {
          lines = highlighter.codeToTokensBase(strippedContent, { theme: themeName, lang: language })
        }

        const themeAttributes = {
          'data-theme': themeAlias,
        }

        const children = lines.map(
          (parts) =>
            new Tag(
              'span',
              { 'data-line': '' },
              parts.map(
                (part) =>
                  new Tag(
                    'span',
                    {
                      style: `${part.htmlStyle ? `${part.htmlStyle};` : ''}${part.color ? `color: ${part.color};` : ''}${part.bgColor ? `background-color: ${part.bgColor};` : ''}${part.fontStyle === FontStyle.Italic ? 'font-style: italic;' : part.fontStyle === FontStyle.Bold ? 'font-weight: bold;' : ''}${part.fontStyle === FontStyle.Underline ? `text-decoration: underline;` : ''}`,
                    },
                    [part.content],
                  ),
              ),
            ),
        )

        themeTags.push(new Tag('code', themeAttributes, children))
      }

      return new Tag('span', { 'data-code': '' }, themeTags)
    },
  }

  const fence: Schema = {
    attributes: {
      content: { type: String, render: false, required: true },
      name: { type: String, render: false },
      language: { type: String, render: false },
      variant: { type: String, render: false },
      showLineNumbers: { type: Boolean, render: false },
      linesHighlighted: { type: Array, render: false },
    },
    async transform(node, config) {
      await initializeHighlighters()

      const name = isString(node.attributes.name) ? node.attributes.name.trim() : ''
      const language = (
        isString(node.attributes.language) ? node.attributes.language.trim() : 'text'
      ) as BundledLanguage
      const variant = isString(node.attributes.variant) ? node.attributes.variant.trim() : ''
      const showLineNumbers = node.attributes.showLineNumbers === true
      const attributes = {
        ...node.transformAttributes(config),
        'data-name': name,
        'data-language': language,
        'data-variant': variant,
      } as Record<string, unknown>
      if (showLineNumbers) {
        attributes['data-show-line-numbers'] = ''
      }

      const highlightedLines = isArray(node.attributes.linesHighlighted)
        ? [...((node.attributes.linesHighlighted as Array<FenceHighlightedLines>) || [])]
            .filter(
              (value) =>
                typeof value === 'object' &&
                value.from != null &&
                typeof value.from === 'number' &&
                value.from >= 0 &&
                (value.to == null || (typeof value.to === 'number' && value.to >= value.from)),
            )
            .sort((a, b) => {
              return a.from - b.from
            })
        : []
      const isLineHighlighted = (lineIndex: number): boolean => {
        for (const { from, to } of highlightedLines) {
          if (lineIndex === from || (lineIndex > from && to != null && lineIndex <= to)) {
            return true
          }
        }
        return false
      }

      const content = isString(node.attributes.content) ? node.attributes.content.trim() : ''
      const themeTags = [] as Array<Tag>
      for (const [themeAlias, { themeName, highlighter }] of highlighters.entries()) {
        let lines = [] as Array<Array<ThemedToken>>
        try {
          lines = highlighter.codeToTokensBase(content, { theme: themeName, lang: language })
        } catch {
          lines = highlighter.codeToTokensBase(content, { theme: themeName, lang: language })
        }

        const themeAttributes = {
          ...attributes,
          'data-theme': themeAlias,
        }

        const children = lines.map(
          (parts, lineIndex) =>
            new Tag(
              'div',
              { 'data-line': '', ...(isLineHighlighted(lineIndex) ? { 'data-line-highlighted': '' } : {}) },
              parts.map(
                (part) =>
                  new Tag(
                    'span',
                    {
                      style: `color:${part.color};`,
                    },
                    [part.content],
                  ),
              ),
            ),
        )

        themeTags.push(new Tag('pre', themeAttributes, [new Tag('code', themeAttributes, children)]))
      }

      return new Tag(
        wrapperTagName,
        {
          'data-content': content,
          ...attributes,
          'data-fence': '',
        },
        themeTags,
      )
    },
  }

  return { code, fence }
}
