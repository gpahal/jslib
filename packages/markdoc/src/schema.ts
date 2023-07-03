import { Schema, Tag } from '@markdoc/markdoc'

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

export function generateImageSchema(transformImageSrcAndGetSize?: TransformImageSrcAndGetSize): Schema {
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
