import { RenderableTreeNode, Tag } from '@markdoc/markdoc'

export function renderableNodeToString(node: RenderableTreeNode): string {
  if (Tag.isTag(node)) {
    return renderableNodesToString(node.children || [])
  } else if (node == null) {
    return ''
  } else if (Array.isArray(node)) {
    return renderableNodesToString(node)
  } else if (typeof node === 'object') {
    return renderableNodesToString(Array.from(Object.values(node)))
  } else {
    return String(node)
  }
}

export function renderableNodesToString(nodes: RenderableTreeNode[]): string {
  return nodes.map(renderableNodeToString).filter(Boolean).join(' ')
}
