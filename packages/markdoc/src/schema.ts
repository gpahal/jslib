import { Schema, Tag } from '@markdoc/markdoc'
import Slugger from 'github-slugger'

import { getNonTransformableImageProps, transformNonTransformableImageSourcePropsToHTMLProps } from '@gpahal/image'

import { renderableNodesToString } from './utils'

export function generateHeadingSchema(): Schema {
  const slugger = new Slugger()
  slugger.reset()

  return {
    children: ['inline'],
    attributes: {
      level: { type: Number, required: true, default: 1 },
      id: { type: String },
    },
    transform(node, config) {
      slugger.reset()

      const children = node.transformChildren(config)
      const attributes = node.transformAttributes(config) as {
        level: number
        id?: string
      }

      const id =
        attributes.id && typeof attributes.id === 'string'
          ? attributes.id
          : slugger.slug(renderableNodesToString(children))

      const tagName = `h${attributes.level}`
      return new Tag(tagName, { id }, [
        new Tag('a', { href: `#${id}`, class: `heading-anchor ${tagName}-anchor` }),
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
