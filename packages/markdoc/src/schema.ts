import { Tag, type Schema } from '@markdoc/markdoc'
import { sha1 } from 'object-hash'
import { getHighlighter, type Highlighter, type IShikiTheme, type IThemedToken } from 'shiki'

import { isArray } from '@gpahal/std/array'
import { isString } from '@gpahal/std/string'

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

const GLOBAL_HIGHLIGHTERS_CACHE = new Map<string, Map<string, Promise<Highlighter>>>()

export type FenceHighlightedLines = {
  from: number
  to?: number
}

export type CodeAndFenceSchemaConfig = {
  theme?: string | Record<string, string>
  wrapperTagName?: string
}

export function generateCodeAndFenceSchema({
  theme = 'github-light',
  wrapperTagName = 'div',
}: CodeAndFenceSchemaConfig = {}): {
  code: Schema
  fence: Schema
} {
  const optionsHash = sha1({
    theme,
  })

  let highlightersCache = GLOBAL_HIGHLIGHTERS_CACHE.get(optionsHash)!
  if (!highlightersCache) {
    highlightersCache = new Map()
    GLOBAL_HIGHLIGHTERS_CACHE.set(optionsHash, highlightersCache)
  }

  const highlighters = new Map<string, Highlighter>()

  if (!theme || isString(theme) || isShikiTheme(theme)) {
    if (!highlightersCache.has('default')) {
      highlightersCache.set('default', getHighlighter({ theme }))
    }
  } else if (typeof theme === 'object') {
    for (const [themeName, themeValue] of Object.entries(theme)) {
      if (!highlightersCache.has(themeName)) {
        highlightersCache.set(themeName, getHighlighter({ theme: themeValue }))
      }
    }
  }

  const initializeHighlighters = async () => {
    for (const [themeName, highlighterPromise] of Array.from(highlightersCache.entries())) {
      if (!highlighters.has(themeName)) {
        highlighters.set(themeName, await highlighterPromise)
      }
    }
  }

  const code: Schema = {
    attributes: {
      content: { type: String, render: false, required: true },
    },
    async transform(node, _config) {
      await initializeHighlighters()

      const content = isString(node.attributes['content']) ? node.attributes['content'].trim() : ''
      const strippedContent = content.replace(/^{:[a-zA-Z.-]+}/, '')
      const meta = content.match(/^{:([a-zA-Z.-]+)}/)?.[1] || ''
      const metaParts = meta.split('.', 2)

      const language = metaParts[0]?.trim() || ''
      const tokenType = metaParts[1]?.trim() || ''

      const themeTags = [] as Tag[]
      for (const [themeName, highlighter] of Array.from(highlighters.entries())) {
        let lines = [] as IThemedToken[][]
        try {
          if (tokenType || (language === 'ansi' && !highlighter.ansiToThemedTokens)) {
            const color =
              (tokenType
                ? highlighter.getTheme().settings.find(({ scope }: { scope?: string[] }) => scope?.includes(tokenType))
                    ?.settings.foreground
                : '') || 'inherit'
            lines = [
              [
                {
                  content: strippedContent,
                  color,
                },
              ],
            ]
          } else {
            lines =
              language === 'ansi'
                ? highlighter.ansiToThemedTokens(strippedContent)
                : highlighter.codeToThemedTokens(strippedContent, language)
          }
        } catch (e) {
          lines = highlighter.codeToThemedTokens(strippedContent, language)
        }

        const themeAttributes = {
          'data-theme': themeName,
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
                      style: `color:${part.color};`,
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

      const name = isString(node.attributes['name']) ? node.attributes['name'].trim() : ''
      const language = isString(node.attributes['language']) ? node.attributes['language'].trim() : ''
      const variant = isString(node.attributes['variant']) ? node.attributes['variant'].trim() : ''
      const showLineNumbers = node.attributes['showLineNumbers'] === true
      const attributes = {
        ...node.transformAttributes(config),
        'data-name': name,
        'data-language': language,
        'data-variant': variant,
      } as Record<string, unknown>
      if (showLineNumbers) {
        attributes['data-show-line-numbers'] = ''
      }

      const highlightedLines = isArray(node.attributes['linesHighlighted'])
        ? [...((node.attributes['linesHighlighted'] as FenceHighlightedLines[]) || [])]
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

      const content = isString(node.attributes['content']) ? node.attributes['content'].trim() : ''
      const themeTags = [] as Tag[]
      for (const [themeName, highlighter] of Array.from(highlighters.entries())) {
        let lines = [] as IThemedToken[][]
        try {
          lines =
            language === 'ansi' && highlighter.ansiToThemedTokens
              ? highlighter.ansiToThemedTokens(content)
              : highlighter.codeToThemedTokens(content, language)
        } catch (e) {
          lines = highlighter.codeToThemedTokens(content, language)
        }

        const themeAttributes = {
          ...attributes,
          'data-theme': themeName,
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

export function isShikiTheme(value: unknown): value is IShikiTheme {
  return value ? {}.hasOwnProperty.call(value, 'tokenColors') : false
}
