import { generateOgImageWithSatoriFn, Node, OgImageOptions } from '~/common'
import satori from 'satori'

export { html } from '~/common'

export type { VNode, Node, OgImageOptions } from '~/common'

export async function generateOgImage(node: Node, options?: OgImageOptions): Promise<string> {
  return await generateOgImageWithSatoriFn(satori, node, options)
}
