import satori from "satori";

import type { Node, OgImageOptions } from "~/common";

import { generateOgImageWithSatoriFn } from "~/common";

export { html } from "~/common";

export type { VNode, Node, OgImageOptions } from "~/common";

export async function generateOgImage(node: Node, options?: OgImageOptions): Promise<string> {
  return await generateOgImageWithSatoriFn(satori, node, options);
}
