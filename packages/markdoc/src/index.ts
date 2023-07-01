import Markdoc, { Node, RenderableTreeNode, Config as TransformConfig, ValidateError } from '@markdoc/markdoc'
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

import { pushToArray } from '@gpahal/std/array'
import { CustomError, getErrorMessage } from '@gpahal/std/error'
import {
  convertFsFileMapToFileMap,
  ConvertFsFileMapToFileMapOptions,
  createFlattenedFileMapIndex,
  FileMap,
  FsFileMapItem,
  FsModule,
  someFileMap,
  walkDirectory,
  WalkOptions,
} from '@gpahal/std/fs'
import { Prettify } from '@gpahal/std/object'
import { stripSuffix } from '@gpahal/std/string'
import { getExtension } from '@gpahal/std/url'

export type { Config as TransformConfig, Node, RenderableTreeNode, ValidateError } from '@markdoc/markdoc'
export type { ReadTimeResults } from 'reading-time'

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

export type ParseResultSuccess<TFrontmatterSchema extends FrontmatterSchema> = {
  isSuccessful: true
  content: RenderableTreeNode
  frontmatter: output<TFrontmatterSchema>
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
  const markdocErrors = Markdoc.validate(document, options?.transformConfig)
  if (markdocErrors && markdocErrors.length > 0) {
    return { isSuccessful: false, type: 'markdoc', markdocErrors }
  }

  const content = Markdoc.transform(document, options?.transformConfig)
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

  const readTimeResults = calculateReadTime(document)
  return {
    isSuccessful: true,
    content,
    frontmatter,
    readTimeResults,
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

function calculateReadTime(node: Node): ReadTimeResults {
  const textContents = findNodeTextContents(node)
  return libCalculateReadTime(textContents ? textContents.join(' ') : '')
}

function findNodeTextContents(node: Node): string[] | undefined {
  let textContents: string[] | undefined
  if (node.type === 'text' || node.type === 'code') {
    const content = node.attributes['content']
    if (content && typeof content === 'string') {
      textContents = pushToArray(textContents, content)
    }
  }
  if (node.children && node.children.length > 0) {
    for (const child of node.children) {
      const childTextContents = findNodeTextContents(child)
      if (childTextContents && childTextContents.length > 0) {
        textContents = pushToArray(textContents, ...childTextContents)
      }
    }
  }
  return textContents
}

export type ParseDirectoryOptions<TFrontmatterSchema extends FrontmatterSchema> = Prettify<
  ParseOptions<TFrontmatterSchema> &
    Omit<WalkOptions<Node>, 'getFileData'> &
    ConvertFsFileMapToFileMapOptions<ParseResult<TFrontmatterSchema>>
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
  options: ParseDirectoryOptions<TFrontmatterSchema>,
): Promise<ParseDirectoryResult<TFrontmatterSchema>> {
  const fileMap = await walkDirectory(fsModule, directory, {
    ...options,
    getFileData: async ({ absolutePath }) => {
      const source = await fsModule.readFile(absolutePath)
      return await parse(source, options)
    },
    fileFilter: (fileOptions) => {
      return getExtension(fileOptions.name) !== 'mdoc' ? false : options?.fileFilter?.(fileOptions) ?? true
    },
  })
  const finalFileMap = fileMap ? fileMap : new Map<string, FsFileMapItem<ParseResult<TFrontmatterSchema>>>()
  const intrusiveFileMap = convertFsFileMapToFileMap(finalFileMap, {
    ...options,
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

function stripMdocExtension(fileName: string): string {
  return stripSuffix(fileName, '.mdoc')
}
