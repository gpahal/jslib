import Markdoc, {
  Config as MarkdocTransformConfig,
  Node,
  NodeType,
  RenderableTreeNode,
  Scalar,
  Schema,
  Tag,
  ValidateError,
} from '@markdoc/markdoc'
import { slug } from 'github-slugger'
import yaml, { YAMLException } from 'js-yaml'
import libCalculateReadTime, { ReadTimeResults } from 'reading-time'
import {
  AnyZodObject,
  input,
  output,
  ZodDiscriminatedUnion,
  ZodEffects,
  ZodError,
  ZodIntersection,
  ZodUnion,
} from 'zod'

import { CustomError, getErrorMessage } from '@gpahal/std/error'
import {
  createFileMap,
  CreateFileMapOptions,
  createFlattenedFileMapIndex,
  FileMap,
  FsFileMap,
  FsFileMapItem,
  FsModule,
  someFileMap,
  walkDirectory,
  WalkOptions,
} from '@gpahal/std/fs'
import { omitUndefinedValues, Prettify } from '@gpahal/std/object'
import { isString, stripSuffix } from '@gpahal/std/string'
import { getExtension } from '@gpahal/std/url'

import {
  CodeAndFenceSchemaConfig,
  generateCodeAndFenceSchema,
  generateHeadingSchema,
  generateImageSchema,
  ImageSchemaOptions,
  linkSchema,
} from './schema'

export type { Node, RenderableTreeNode, RenderableTreeNodes, Scalar, Schema, ValidateError } from '@markdoc/markdoc'
export type { ReadTimeResults } from 'reading-time'
export type { TransformedImageSrcWithSize, TransformImageSrcAndGetSize } from './schema'

export { Tag } from '@markdoc/markdoc'
export { generateHeadingSchema, generateImageSchema, linkSchema } from './schema'
export { renderReact } from './react'

export type TransformConfig = Omit<MarkdocTransformConfig, 'nodes'> & {
  image?: ImageSchemaOptions
  codeAndFence?: CodeAndFenceSchemaConfig
}

const NODE_TYPES: Set<NodeType> = new Set([
  'blockquote',
  'code',
  'comment',
  'document',
  'em',
  'error',
  'fence',
  'hardbreak',
  'heading',
  'hr',
  'image',
  'inline',
  'item',
  'link',
  'list',
  'node',
  'paragraph',
  's',
  'softbreak',
  'strong',
  'table',
  'tag',
  'tbody',
  'td',
  'text',
  'th',
  'thead',
  'tr',
])

function getMarkdocTransformConfig({ image, codeAndFence, ...config }: TransformConfig = {}): MarkdocTransformConfig {
  const tags = {
    heading: generateHeadingSchema(),
    image: generateImageSchema(image),
    link: linkSchema,
    ...generateCodeAndFenceSchema(codeAndFence),
    ...(config.tags ? omitUndefinedValues(config.tags) : {}),
  }

  const nodes = {} as Partial<Record<NodeType, Schema>>
  Object.entries(tags).forEach(([tagName, tag]) => {
    if (NODE_TYPES.has(tagName as NodeType)) {
      nodes[tagName as NodeType] = tag
    }
  })

  return {
    ...config,
    nodes,
    tags,
  }
}

export type FrontmatterRaw = Record<string, unknown>

type FrontmatterSchemaWithoutEffects =
  | AnyZodObject
  | ZodUnion<[AnyZodObject, ...AnyZodObject[]]>
  | ZodDiscriminatedUnion<string, AnyZodObject[]>
  | ZodIntersection<AnyZodObject, AnyZodObject>

export type FrontmatterSchema = FrontmatterSchemaWithoutEffects | ZodEffects<FrontmatterSchemaWithoutEffects>

export type ParseOptions<TFrontmatterSchema extends FrontmatterSchema> = {
  frontmatterSchema?: TFrontmatterSchema
  transformConfig?: TransformConfig
}

export type HeadingNode = {
  level: number
  id: string
  text: string
  children: HeadingNode[]
}

export type ParseResultSuccess<TFrontmatterSchema extends FrontmatterSchema> = {
  isSuccessful: true
  content: RenderableTreeNode
  frontmatter: output<TFrontmatterSchema>
  headingNodes: HeadingNode[]
  readTimeResults: ReadTimeResults
}

export type ParseResultMarkdocError = {
  isSuccessful: false
  type: 'markdoc'
  markdocErrors: ValidateError[]
}

export class YamlError extends CustomError {
  public constructor(message: string, public readonly line: number, public readonly column: number) {
    super(message)
  }
}

export type ParseResultYamlError = {
  isSuccessful: false
  type: 'yaml'
  yamlError: YamlError
}

export type ParseResultZodError<TFrontmatterSchema extends FrontmatterSchema> = {
  isSuccessful: false
  type: 'zod'
  zodError: ZodError<input<TFrontmatterSchema>>
}

export type ParseResultError<TFrontmatterSchema extends FrontmatterSchema> =
  | ParseResultMarkdocError
  | ParseResultYamlError
  | ParseResultZodError<TFrontmatterSchema>

export type ParseResult<TFrontmatterSchema extends FrontmatterSchema> =
  | ParseResultSuccess<TFrontmatterSchema>
  | ParseResultError<TFrontmatterSchema>

export async function parse<TFrontmatterSchema extends FrontmatterSchema>(
  source: string,
  options?: ParseOptions<TFrontmatterSchema>,
): Promise<ParseResult<TFrontmatterSchema>> {
  const document = Markdoc.parse(source)

  const transformConfig = getMarkdocTransformConfig(options?.transformConfig)
  const markdocErrors = Markdoc.validate(document, transformConfig)
  if (markdocErrors && markdocErrors.length > 0) {
    return { isSuccessful: false, type: 'markdoc', markdocErrors }
  }

  const headingNodes = generateHeadingNodes(document, transformConfig)
  const content = await awaitRenderableTreeNode(Markdoc.transform(document, transformConfig))
  const frontmatterRawParseResults = parseFrontmatterRaw(document)
  if (!frontmatterRawParseResults.isSuccessful) {
    return frontmatterRawParseResults
  }

  let frontmatter: output<TFrontmatterSchema> = frontmatterRawParseResults.frontmatterRaw
  if (options?.frontmatterSchema) {
    const zodParseResults = await options.frontmatterSchema.safeParseAsync(frontmatterRawParseResults.frontmatterRaw)
    if (!zodParseResults.success) {
      return { isSuccessful: false, type: 'zod', zodError: zodParseResults.error }
    }
    frontmatter = zodParseResults.data
  }

  return {
    isSuccessful: true,
    content,
    frontmatter,
    headingNodes,
    readTimeResults: libCalculateReadTime(renderableNodeToString(content)),
  }
}

export function formatParseResultError<TFrontmatterSchema extends FrontmatterSchema>(
  error: ParseResultError<TFrontmatterSchema>,
): string {
  switch (error.type) {
    case 'markdoc':
      return formatMarkdocErrors(error.markdocErrors)
    case 'yaml':
      return formatYamlError(error.yamlError)
    case 'zod':
      return formatZodError(error.zodError)
    default:
      return ''
  }
}

export function formatMarkdocErrors(errors: ValidateError[]): string {
  return errors.map((error) => `- ${formatMarkdocError(error)}`).join('\n')
}

export function formatMarkdocError(error: ValidateError): string {
  const startLocation = error.location?.start
    ? { line: error.location.start.line, column: error.location.start.character }
    : error.lines.length > 0
    ? { line: error.lines[0]! }
    : undefined
  const endLocation = error.location?.end
    ? { line: error.location.end.line, column: error.location.end.character }
    : error.lines.length > 1
    ? { line: error.lines[error.lines.length - 1]! }
    : undefined
  return `${startLocation ? `${formatErrorLocationRange(startLocation, endLocation)}: ` : ''}${error.error.message}`
}

export function formatYamlError(error: YamlError): string {
  return `${formatErrorLocation(error)}: ${error.message}`
}

export function formatZodError<T>(error: ZodError<T>): string {
  const flattenedErrors = error.flatten()
  const allFieldErrors = flattenedErrors.fieldErrors
  return Object.entries<string[] | undefined>(allFieldErrors)
    .map(([fieldName, fieldErrors]) => {
      if (!fieldErrors || fieldErrors.length === 0) {
        return ''
      }
      if (fieldErrors.length === 1) {
        return `${fieldName}: ${fieldErrors[0]}`
      }
      return `${fieldName}:\n${fieldErrors.map((error) => `  - ${error}`).join('\n')}`
    })
    .filter(Boolean)
    .map((error) => `- ${error}`)
    .join('\n')
}

function formatErrorLocationRange(
  startLocation?: { line: number; column?: number },
  endLocation?: { line: number; column?: number },
): string {
  return startLocation
    ? `${formatErrorLocation(startLocation)}${endLocation ? `-${formatErrorLocation(endLocation)}` : ''}`
    : ''
}

function formatErrorLocation(location?: { line: number; column?: number }): string {
  return location ? `${location.line}${location.column == null ? '' : `:${location.column}`}` : ''
}

function parseFrontmatterRaw(
  node: Node,
): { isSuccessful: true; frontmatterRaw: FrontmatterRaw } | ParseResultYamlError {
  const s = node.attributes['frontmatter']
  if (!s) {
    return { isSuccessful: true, frontmatterRaw: {} }
  }

  if (typeof s !== 'string') {
    return {
      isSuccessful: false,
      type: 'yaml',
      yamlError: new YamlError('Frontmatter must be a YAML object', 1, 1),
    }
  }

  let parsedFrontmatter: unknown
  try {
    parsedFrontmatter = yaml.load(s)
  } catch (e) {
    let line = 1
    let column = 1
    if (e instanceof YAMLException) {
      line = e.mark.line
      column = e.mark.column
    }
    if (
      e instanceof Error &&
      'line' in e &&
      typeof e.line === 'number' &&
      'column' in e &&
      typeof e.column === 'number'
    ) {
      line = e.line
      column = e.column
    }
    return {
      isSuccessful: false,
      type: 'yaml',
      yamlError: new YamlError(`Frontmatter must be a YAML object: ${getErrorMessage(e)}`, line, column),
    }
  }

  if (!parsedFrontmatter) {
    return { isSuccessful: true, frontmatterRaw: {} }
  }
  if (typeof parsedFrontmatter !== 'object') {
    return {
      isSuccessful: false,
      type: 'yaml',
      yamlError: new YamlError('Frontmatter must be a YAML object', 1, 1),
    }
  }
  return { isSuccessful: true, frontmatterRaw: parsedFrontmatter as Record<string, unknown> }
}

function generateHeadingNodes(node: Node, transformConfig?: TransformConfig): HeadingNode[] {
  const slugger = new Slugger()
  const headingNodes = [] as HeadingNode[]
  updateHeadingNodesInternal(headingNodes, node, slugger, transformConfig)
  return headingNodes
}

function updateHeadingNodesInternal(
  headingNodes: HeadingNode[],
  node: Node,
  slugger: Slugger,
  transformConfig?: TransformConfig,
): void {
  if (node.type === 'heading') {
    const level = node.attributes['level'] ?? 1
    if (typeof level === 'number' && level >= 1 && level <= 6) {
      const renderableChildren = Markdoc.transform(node.children, transformConfig)
      const text = renderableNodesToString(renderableChildren)
      const id =
        node.attributes['id'] && typeof node.attributes['id'] === 'string' ? node.attributes['id'] : slugger.slug(text)
      node.attributes['id'] = id

      const headingNode = {
        level: node.attributes['level'] ?? 1,
        id,
        text,
        children: [],
      }

      if (headingNodes.length === 0) {
        headingNodes.push(headingNode)
        return
      } else {
        const lowestLevel = headingNodes[0]!.level
        if (level === lowestLevel) {
          headingNodes.push(headingNode)
        } else if (level > lowestLevel) {
          let currHeadingNodes: HeadingNode[] = headingNodes
          let currHeadingNode: HeadingNode | undefined
          for (let currLevel = lowestLevel; currLevel < level; currLevel++) {
            if (currHeadingNodes.length === 0) {
              return
            }

            currHeadingNode = currHeadingNodes[currHeadingNodes.length - 1]
            if (!currHeadingNode) {
              break
            }

            currHeadingNodes = currHeadingNode.children
          }

          if (currHeadingNode) {
            currHeadingNode.children.push(headingNode)
          }
        }
      }
    }
  }

  for (const child of node.children) {
    updateHeadingNodesInternal(headingNodes, child, slugger, transformConfig)
  }
}

export type ParseDirectoryOptions<TFrontmatterSchema extends FrontmatterSchema> = Prettify<
  ParseOptions<TFrontmatterSchema> &
    Omit<WalkOptions<Node>, 'parseFileContents'> &
    CreateFileMapOptions<ParseResult<TFrontmatterSchema>>
>

export type ParseDirectoryResultSuccess<TFrontmatterSchema extends FrontmatterSchema> = {
  isSuccessful: true
  data: FileMap<ParseResultSuccess<TFrontmatterSchema>>
}

export type ParseDirectoryResultError<TFrontmatterSchema extends FrontmatterSchema> = {
  isSuccessful: false
  data: FileMap<ParseResult<TFrontmatterSchema>>
}

export type ParseDirectoryResult<TFrontmatterSchema extends FrontmatterSchema> =
  | ParseDirectoryResultSuccess<TFrontmatterSchema>
  | ParseDirectoryResultError<TFrontmatterSchema>

export async function parseDirectory<TFrontmatterSchema extends FrontmatterSchema>(
  fsModule: FsModule,
  directory: string,
  getIndexFileName: (
    directoryName: string,
    fsFileMap: FsFileMap<ParseResult<TFrontmatterSchema>>,
  ) => string | undefined,
  options?: ParseDirectoryOptions<TFrontmatterSchema>,
): Promise<ParseDirectoryResult<TFrontmatterSchema>> {
  const fileMap = await walkDirectory(fsModule, directory, {
    ...(options || {}),
    parseFileContents: async (contents) => {
      return await parse(contents, options)
    },
    fileFilter: (fileOptions) => {
      return getExtension(fileOptions.name) !== 'mdoc' ? false : options?.fileFilter?.(fileOptions) ?? true
    },
  })
  const finalFileMap = fileMap ? fileMap : new Map<string, FsFileMapItem<ParseResult<TFrontmatterSchema>>>()
  const intrusiveFileMap = createFileMap(finalFileMap, getIndexFileName, {
    transformFileName: (fileName, fsFileMapFileItem) => {
      const fileNameWithoutExtension = stripMdocExtension(fileName)
      return options?.transformFileName
        ? options.transformFileName(fileNameWithoutExtension, fsFileMapFileItem)
        : fileNameWithoutExtension
    },
  })
  const hasError = someFileMap(intrusiveFileMap, (item) => !item.isSuccessful)
  return hasError
    ? { isSuccessful: false, data: intrusiveFileMap }
    : {
        isSuccessful: true,
        data: intrusiveFileMap as FileMap<ParseResultSuccess<TFrontmatterSchema>>,
      }
}

export function formatParseDirectoryResultErrors<TFrontmatterSchema extends FrontmatterSchema>(
  result: FileMap<ParseResult<TFrontmatterSchema>>,
): string {
  const flattenedFileMapIndex = createFlattenedFileMapIndex(result)
  return flattenedFileMapIndex
    .map((item) => (item.data.isSuccessful ? '' : `${item.path}:\n${formatParseResultError(item.data)}`))
    .filter(Boolean)
    .join('\n\n')
}

async function awaitRenderableTreeNode(
  node: RenderableTreeNode | Promise<RenderableTreeNode>,
): Promise<RenderableTreeNode> {
  const awaited = await node
  if (awaited == null) {
    return awaited
  } else if (Array.isArray(awaited)) {
    return (await awaitRenderableTreeNodes(awaited)) as RenderableTreeNode
  } else if (Tag.isTag(awaited)) {
    awaited.children = await awaitRenderableTreeNodes((await awaited.children) || [])
    return awaited
  } else if (typeof awaited === 'object') {
    for (const [key, value] of Array.from(Object.entries(awaited))) {
      awaited[key] = (await awaitRenderableTreeNode(value)) as Scalar
    }
    return awaited
  } else {
    return awaited
  }
}

async function awaitRenderableTreeNodes(
  nodes: (RenderableTreeNode | Promise<RenderableTreeNode>)[],
): Promise<RenderableTreeNode[]> {
  return await Promise.all(nodes.map(awaitRenderableTreeNode))
}

export function renderableNodeToString(node: RenderableTreeNode): string {
  if (node == null) {
    return ''
  } else if (Array.isArray(node)) {
    return renderableNodesToString(node)
  } else if (Tag.isTag(node)) {
    return renderableNodesToString(node.children || [])
  } else if (typeof node === 'object') {
    return renderableNodesToString(Array.from(Object.values(node)))
  } else {
    return String(node)
  }
}

function renderableNodesToString(nodes: RenderableTreeNode[]): string {
  return nodes.map(renderableNodeToString).filter(Boolean).join(' ')
}

export function getRenderableTreeNodeIdsMap(node: RenderableTreeNode): Map<string, RenderableTreeNode> {
  const map = new Map<string, RenderableTreeNode>()
  updateRenderableTreeNodeIdsMap(map, node)
  return map
}

function updateRenderableTreeNodeIdsMap(map: Map<string, RenderableTreeNode>, node: RenderableTreeNode) {
  if (node == null) {
    return
  } else if (Array.isArray(node)) {
    updateRenderableTreeNodesIdsMap(map, node)
  } else if (Tag.isTag(node)) {
    const id = node.attributes?.['id'] || ''
    if (isString(id) && id.trim()) {
      map.set(id.trim(), node)
    }
    updateRenderableTreeNodesIdsMap(map, node.children || [])
  } else if (typeof node === 'object') {
    updateRenderableTreeNodesIdsMap(map, Array.from(Object.values(node)))
  }
}

function updateRenderableTreeNodesIdsMap(map: Map<string, RenderableTreeNode>, nodes: RenderableTreeNode[]) {
  nodes.forEach((node) => updateRenderableTreeNodeIdsMap(map, node))
}

function stripMdocExtension(fileName: string): string {
  return stripSuffix(fileName, '.mdoc')
}

class Slugger {
  private occurrences: Map<string, number>

  constructor() {
    this.occurrences = new Map()
  }

  slug(value: string, maintainCase?: boolean): string {
    let finalSlug = slug(value, !!maintainCase)
    const originalSlug = finalSlug

    while (true) {
      const count = this.occurrences.get(finalSlug)
      if (count == null) {
        break
      }

      const newCount = count + 1
      this.occurrences.set(originalSlug, newCount)
      finalSlug = originalSlug + '-' + newCount
    }

    this.occurrences.set(finalSlug, 0)
    return finalSlug
  }

  reset() {
    this.occurrences.clear()
  }
}
