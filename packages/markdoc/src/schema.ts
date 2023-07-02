import { Schema, Tag } from '@markdoc/markdoc'

import { getNonTransformableImageProps, transformNonTransformableImageSourcePropsToHTMLProps } from '@gpahal/image'

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

export type TransformedImageSrc = {
  src: string
  width?: number
  height?: number
}

export type TransformImageSrc = (src: string) => TransformedImageSrc | undefined

export function generateImageSchema(transformImageSrc?: TransformImageSrc): Schema {
  return {
    attributes: {
      src: { type: String, required: true },
      alt: { type: String, required: true },
      title: { type: String },
    },
    transform(node, config) {
      const attributes = node.transformAttributes(config) as {
        src: string
        alt: string
        title?: string
      }
      const {
        src = attributes.src,
        width = undefined,
        height = undefined,
      } = transformImageSrc ? transformImageSrc(attributes.src) || {} : {}
      if (width == null || height == null) {
        return new Tag('img', { ...attributes, src: src || attributes.src })
      }

      const props = transformNonTransformableImageSourcePropsToHTMLProps(
        getNonTransformableImageProps({
          src: src || attributes.src,
          aspectRatio: width / height,
          layout: { type: 'vw-ratio', vwRatio: 1, maxWidth: width },
          alt: attributes.alt,
        }),
      )

      return new Tag(
        'img',
        {
          ...attributes,
          width: `${width}px`,
          height: `${height}px`,
          ...props,
        },
        [],
      )
    },
  }
}
