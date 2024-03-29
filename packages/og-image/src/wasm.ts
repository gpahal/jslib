import satori, { init as satoriInit } from 'satori/wasm'
import initYogaWeb from 'yoga-wasm-web'

import { generateOgImageWithSatoriFn, type Node, type OgImageOptions } from '@/common'

export { html } from '@/common'

export type { VNode, Node, OgImageOptions } from '@/common'

export function init(yogaWasm: ArrayBuffer) {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const yoga = initYogaWeb(yogaWasm)
  satoriInit(yoga)
}

export async function generateOgImage(node: Node, options?: OgImageOptions): Promise<string> {
  return await generateOgImageWithSatoriFn(satori, node, options)
}
