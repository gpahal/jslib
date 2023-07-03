import * as React from 'react'

import { RenderableTreeNode, RenderableTreeNodes, Scalar, Tag } from '@markdoc/markdoc'

import { isFunction } from '@gpahal/std/function'

type ReactShape = Readonly<{
  createElement: typeof React.createElement
  Fragment: typeof React.Fragment
}>

type ComponentType = React.ElementType
export type Components = Record<string, ComponentType> | ((string: string) => ComponentType)

function getComponent(tagName: Scalar, components?: Components): string | ComponentType {
  if (typeof tagName !== 'string' || !tagName) {
    return String(tagName)
  }

  const component = components
    ? isFunction(components)
      ? (components(tagName) as ComponentType)
      : (components as Record<string, ComponentType>)[tagName]
    : undefined
  return component || tagName
}

export function renderReact(React: ReactShape, node: RenderableTreeNodes, components?: Components) {
  function renderInternal(node: RenderableTreeNodes): React.ReactNode {
    if (Array.isArray(node)) {
      return React.createElement(React.Fragment, null, ...node.map(renderInternal))
    } else if (node == null || typeof node !== 'object' || !Tag.isTag(node)) {
      return node as React.ReactNode
    }

    const { name, attributes, children } = node
    const { class: className, ...otherAttributes } = (attributes || {}) as {
      class?: string
      [key: string]: unknown
    }

    if (className) {
      otherAttributes['className'] = className
    }

    return React.createElement(
      getComponent(name, components),
      Object.keys(otherAttributes).length === 0
        ? undefined
        : (renderNestedInternal(otherAttributes as RenderableTreeNode) as Record<string, unknown>),
      ...(children || []).map(renderInternal),
    )
  }

  function renderNestedInternal(node: RenderableTreeNode): unknown {
    if (node == null || typeof node !== 'object') {
      return node
    } else if (Array.isArray(node)) {
      return node.map((item) => renderNestedInternal(item))
    } else if (Tag.isTag(node)) {
      return renderInternal(node)
    } else {
      const output: Record<string, Scalar> = {}
      for (const [k, v] of Object.entries(node)) {
        output[k] = renderNestedInternal(v) as Scalar
      }
      return output
    }
  }

  return renderInternal(node)
}
