import * as React from 'react'

import { RenderableTreeNode, RenderableTreeNodes, Scalar, Tag } from '@markdoc/markdoc'

import { isFunction } from '@gpahal/std/function'
import { isObject } from '@gpahal/std/object'
import { camelCase, isString } from '@gpahal/std/string'

export type { Node, RenderableTreeNode, RenderableTreeNodes, Scalar, Schema, ValidateError } from '@markdoc/markdoc'

export { Tag } from '@markdoc/markdoc'

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

export function renderReact(React: ReactShape, node: RenderableTreeNodes, components?: Components): React.ReactNode {
  function renderInternal(node: RenderableTreeNodes): React.ReactNode {
    if (Array.isArray(node)) {
      return React.createElement(React.Fragment, null, ...node.map(renderInternal))
    } else if (node == null || typeof node !== 'object' || !Tag.isTag(node)) {
      return node as React.ReactNode
    }

    const { name, attributes, children } = node
    const {
      class: className,
      style,
      ...otherAttributes
    } = (attributes || {}) as {
      class?: string
      style?: string
      [key: string]: unknown
    }

    if (className) {
      otherAttributes['className'] = className
    }
    if (style) {
      if (style && isObject('object')) {
        otherAttributes['style'] = style
      } else if (isString(style)) {
        const properties = style.split(';')
        const styleObj = {} as Record<string, unknown>
        properties.forEach((property) => {
          const parts = property.split(':').map((s) => s.trim())
          if (parts[0] && parts[1]) {
            styleObj[camelCase(parts[0].replaceAll(/-+/g, ' '))] = parts[1]
          }
        })
        otherAttributes['style'] = styleObj
      }
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
