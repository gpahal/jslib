import type { ReactNode } from 'react'

import type { SatoriOptions } from 'satori'
import { html as htmlLib } from 'satori-html'

import type { FontInfo } from '@gpahal/font'

export type VNode = {
  type: string
  props: {
    children?: string | Array<string> | VNode | Array<VNode>
    style?: Record<string, unknown>
    [prop: string]: unknown
  }
}

export type Node = ReactNode | VNode

export function html(
  templates: string | TemplateStringsArray,
  ...expressions: Array<unknown>
): Node {
  return htmlLib(templates, ...expressions) as VNode
}

export type OgImageOptions = {
  width?: number
  height?: number
  fonts?: Array<FontInfo>
  debug?: boolean
}

export type SatoriFn = (element: ReactNode, options: SatoriOptions) => Promise<string>

export async function generateOgImageWithSatoriFn(
  satoriFn: SatoriFn,
  node: Node,
  options?: OgImageOptions,
): Promise<string> {
  const optionWidth = options?.width && options.width > 0 ? options.width : undefined
  const optionHeight = options?.height && options.height > 0 ? options.height : undefined
  let width = 1200
  let height = 630
  if (optionWidth && optionHeight) {
    width = optionWidth
    height = optionHeight
  } else if (optionWidth || optionHeight) {
    if (optionWidth) {
      height = Math.round((optionWidth * height) / width)
    } else if (optionHeight) {
      width = Math.round((optionHeight * width) / height)
    }
  }

  const optionFonts = options?.fonts || []
  const fonts = await Promise.all(optionFonts.map(getSatoriFontOptions))

  return await satoriFn(node as ReactNode, {
    width,
    height,
    fonts,
  })
}

async function getSatoriFontOptions(font: FontInfo): Promise<SatoriOptions['fonts'][number]> {
  if (typeof font.data === 'function') {
    return {
      ...font,
      data: await font.data(),
    }
  }
  return {
    ...font,
    data: await font.data,
  }
}
