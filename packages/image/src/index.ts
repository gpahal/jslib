import mime from 'mime'

import type { Prettify } from '@gpahal/std/object'
import { getExtension } from '@gpahal/std/url'

export type OutputImageFormatSupportsAlpha = 'avif' | 'png' | 'tiff' | 'webp'
export type OutputImageFormatNotSupportsAlpha = 'gif' | 'jpeg' | 'jpg'
export type OutputImageFormat = OutputImageFormatSupportsAlpha | OutputImageFormatNotSupportsAlpha

export const OUTPUT_IMAGE_FORMATS_WITH_ALPHA: OutputImageFormatSupportsAlpha[] = ['avif', 'png', 'tiff', 'webp']
export const OUTPUT_IMAGE_FORMATS_WITHOUT_ALPHA: OutputImageFormatNotSupportsAlpha[] = ['gif', 'jpeg', 'jpg']
export const OUTPUT_IMAGE_FORMATS: OutputImageFormat[] = [
  ...OUTPUT_IMAGE_FORMATS_WITH_ALPHA,
  ...OUTPUT_IMAGE_FORMATS_WITHOUT_ALPHA,
]

export type CropOptions =
  | {
      fit: 'contain'
    }
  | {
      fit: 'cover'
    }
  | {
      fit: 'fill'
    }
  | {
      fit: 'inside'
    }
  | {
      fit: 'outside'
    }

export type BaseTransformImageRequest = {
  cropOptions?: CropOptions
  format?: OutputImageFormat
  quality?: number
  width?: number
  height?: number
}

export type TransformImageBufferRequest = BaseTransformImageRequest & {
  src: Buffer
}

export type TransformImageBufferResponse = {
  output: Buffer
  format: OutputImageFormat
  width: number
  height: number
}

export type TransformImageBufferFn = (request: TransformImageBufferRequest) => Promise<TransformImageBufferResponse>

export type TransformImageSrcRequest = BaseTransformImageRequest & {
  src: string
}

export type TransformImageSrcFn = (request: TransformImageSrcRequest) => string

type MaxWidthImageLayout = {
  type: 'max-width'
  maxWidth: number
}

type VwRatioImageLayout = {
  type: 'vw-ratio'
  vwRatio: number
  maxWidth?: number
}

type ImageLayout = MaxWidthImageLayout | VwRatioImageLayout

const DEVICE_WIDTHS = [640, 750, 828, 960, 1080, 1280, 1920, 2048, 3840] as const

const DEFAULT_DEVICE_WIDTH = DEVICE_WIDTHS[6]!
const SMALLEST_DEVICE_WIDTH = DEVICE_WIDTHS[0]!
const LARGEST_DEVICE_WIDTH = DEVICE_WIDTHS[DEVICE_WIDTHS.length - 1]!

const IMAGE_WIDTHS = [16, 32, 48, 64, 96, 128, 256, 384] as const

const LOW_RESOLUTION_WIDTH = 32 as const
const LOW_RESOLUTION_OUTPUT_FORMAT = 'png' as const

function getImageLayoutBreakpoints(layout: ImageLayout): number[] {
  switch (layout.type) {
    case 'max-width':
      return getMaxWidthImageLayoutBreakpoints(layout)
    case 'vw-ratio':
      return getVwRatioImageLayoutBreakpoints(layout)
  }
}

function getMaxWidthImageLayoutBreakpoints({ maxWidth }: MaxWidthImageLayout): number[] {
  return [maxWidth, ...DEVICE_WIDTHS.filter((w) => w < maxWidth)]
}

function getVwRatioImageLayoutBreakpoints({ vwRatio, maxWidth: layoutMaxWidth }: VwRatioImageLayout): number[] {
  const minWidth = SMALLEST_DEVICE_WIDTH * vwRatio
  let maxWidth = LARGEST_DEVICE_WIDTH * vwRatio
  if (layoutMaxWidth != null && layoutMaxWidth > 0) {
    maxWidth = Math.min(maxWidth, layoutMaxWidth)
  }
  return [...IMAGE_WIDTHS, ...DEVICE_WIDTHS].filter((w) => w >= minWidth && w <= maxWidth)
}

function getImageLayoutSizesAttribute(layout: ImageLayout): string {
  switch (layout.type) {
    case 'max-width':
      return `(min-width: ${layout.maxWidth}px) ${layout.maxWidth}px, 100vw`
    case 'vw-ratio':
      return `${
        layout.maxWidth != null && layout.maxWidth > 0 ? `(min-width: ${layout.maxWidth}px) ${layout.maxWidth}px, ` : ''
      }${layout.vwRatio}vw`
  }
}

function getImageSrcSetAttribute({
  src,
  transformer,
  cropOptions,
  aspectRatio,
  layout,
  format,
}: {
  src: string
  transformer: TransformImageSrcFn
  cropOptions: CropOptions
  aspectRatio: number
  layout: ImageLayout
  format?: OutputImageFormat
}): string {
  const breakpoints = getImageLayoutBreakpoints(layout)
  return breakpoints
    .sort()
    .map((width) => {
      const height = Math.round(width / aspectRatio)
      const transformedSrc = transformer({
        src,
        cropOptions,
        format,
        width,
        height,
      })
      return `${transformedSrc.toString()} ${width}w`
    })
    .join(',\n')
}

export type ImageObjectFit = 'contain' | 'cover' | 'fill' | 'none' | 'scale-down' | 'inherit' | 'initial'

export type ImageStyle = {
  width?: string
  maxWidth?: string
  height?: string
  maxHeight?: string
  aspectRatio?: string

  background?: string
  backgroundImage?: string
  backgroundSize?: string
  backgroundRepeat?: string

  objectFit?: ImageObjectFit
}

function transformImageStyleToCSSProps({
  width,
  maxWidth,
  height,
  maxHeight,
  aspectRatio,
  background,
  backgroundImage,
  backgroundSize,
  backgroundRepeat,
  objectFit,
}: ImageStyle): Record<string, string> {
  const styleArray = [
    { name: 'width', value: width },
    { name: 'max-width', value: maxWidth },
    { name: 'height', value: height },
    { name: 'max-height', value: maxHeight },
    { name: 'aspect-ratio', value: aspectRatio },
    { name: 'background', value: background },
    { name: 'background-image', value: backgroundImage },
    { name: 'background-size', value: backgroundSize },
    { name: 'background-repeat', value: backgroundRepeat },
    { name: 'object-fit', value: objectFit },
  ]

  return styleArray.reduce(
    (acc, { name, value }) => {
      if (value) {
        acc[name] = value
      }
      return acc
    },
    {} as Record<string, string>,
  )
}

function getImageStyle({
  aspectRatio,
  layout,
  background,
  objectFit = 'cover',
}: {
  aspectRatio: number
  layout: ImageLayout
  background?: string
  objectFit?: ImageObjectFit
}): ImageStyle {
  const style: ImageStyle = {
    objectFit,
  }

  if (
    background?.startsWith('https:') ||
    background?.startsWith('http:') ||
    background?.startsWith('data:') ||
    background?.startsWith('/')
  ) {
    style.backgroundImage = `url(${background})`
    style.backgroundSize = 'cover'
    style.backgroundRepeat = 'no-repeat'
  } else {
    style.background = background
  }

  style.width = '100%'
  style.aspectRatio = `${aspectRatio}`
  if (layout.maxWidth != null) {
    style.maxWidth = pixelate(layout.maxWidth)
    style.maxHeight = pixelate(layout.maxWidth / aspectRatio)
  }

  return style
}

function pixelate(value?: number) {
  return value || value === 0 ? `${value}px` : undefined
}

export const FALLBACK_IMAGE_BACKGROUND_PREFIX = 'fallback:'

type NonTransformableImageSourceOptions = {
  src: string
  aspectRatio: number
  layout?: ImageLayout
  background?: string
  objectFit?: ImageObjectFit
}

type NonTransformableImageSourceProps = {
  src: string
  style: ImageStyle
}

export function transformNonTransformableImageSourcePropsToHTMLProps({
  src,
  style,
}: NonTransformableImageSourceProps): Record<string, string> {
  return {
    src,
    style: Array.from(Object.entries(transformImageStyleToCSSProps(style)))
      .map(([name, value]) => `${name}:${value};`)
      .join(''),
  }
}

function getNonTransformableImageSourceProps({
  src,
  aspectRatio,
  layout = { type: 'vw-ratio', vwRatio: 1 },
  background,
  objectFit = 'cover',
}: NonTransformableImageSourceOptions): NonTransformableImageSourceProps {
  if (background?.startsWith(FALLBACK_IMAGE_BACKGROUND_PREFIX)) {
    background = background.slice(FALLBACK_IMAGE_BACKGROUND_PREFIX.length).trim()
  }
  const style = getImageStyle({ aspectRatio, layout, background, objectFit })
  return {
    src,
    style,
  }
}

type ImageSourceOptions = NonTransformableImageSourceOptions & {
  transformer: TransformImageSrcFn
  cropOptions?: CropOptions
  format?: OutputImageFormat
}

type ImageSourceProps = NonTransformableImageSourceProps & {
  sizes: string
  srcSet: string
}

export function transformImageSourcePropsToHTMLProps({
  sizes,
  srcSet,
  ...nonTransformableImageSourceProps
}: ImageSourceProps): Record<string, string> {
  return {
    ...transformNonTransformableImageSourcePropsToHTMLProps(nonTransformableImageSourceProps),
    sizes,
    srcset: srcSet,
  }
}

function getImageSourceProps({
  transformer,
  cropOptions = { fit: 'cover' },
  format,
  ...nonTransformableOptions
}: ImageSourceOptions): ImageSourceProps {
  let { background } = nonTransformableOptions
  if (background === 'auto') {
    background = transformer({
      src: nonTransformableOptions.src,
      cropOptions,
      format: LOW_RESOLUTION_OUTPUT_FORMAT,
      width: LOW_RESOLUTION_WIDTH,
      height: Math.round(LOW_RESOLUTION_WIDTH / nonTransformableOptions.aspectRatio),
    })
    nonTransformableOptions = {
      ...nonTransformableOptions,
      background,
    }
  }

  const nonTransformableImageSourceProps = getNonTransformableImageSourceProps(nonTransformableOptions)
  const style = nonTransformableImageSourceProps.style

  const { aspectRatio, layout = { type: 'vw-ratio', vwRatio: 1 } } = nonTransformableOptions
  const finalWidth = layout.maxWidth != null ? Math.min(layout.maxWidth, DEFAULT_DEVICE_WIDTH) : DEFAULT_DEVICE_WIDTH
  let src = nonTransformableImageSourceProps.src
  src = transformer({
    src,
    cropOptions,
    format,
    width: finalWidth,
    height: Math.round(finalWidth / aspectRatio),
  })

  const sizes = getImageLayoutSizesAttribute(layout)
  const srcSet = getImageSrcSetAttribute({
    src,
    transformer,
    cropOptions,
    aspectRatio,
    layout,
    format,
  })

  return {
    src,
    sizes,
    srcSet,
    style,
  }
}

export type ImageRole = 'presentation' | 'img' | 'none' | 'figure'

type ImageNonSourceOptions = {
  alt?: string
  role?: ImageRole
  isPriority?: boolean
}

export type ImageDecoding = 'sync' | 'async' | 'auto'
export type ImageLoading = 'eager' | 'lazy'
export type ImageFetchPriority = 'high' | 'low' | 'auto'

type ImageNonSourceProps = {
  alt: string
  role?: ImageRole
  loading: ImageLoading
  decoding: ImageDecoding
  fetchPriority: ImageFetchPriority
}

function transformImageNoneSourcePropsToHTMLProps({
  fetchPriority,
  ...rest
}: ImageNonSourceProps): Record<string, string> {
  return {
    ...rest,
    fetchpriority: fetchPriority,
  }
}

function getImageNonSourceProps({ alt, role, isPriority }: ImageNonSourceOptions): ImageNonSourceProps {
  if (!alt) {
    alt = ''
    role ||= 'presentation'
  }

  let loading: ImageLoading = 'lazy'
  let decoding: ImageDecoding = 'async'
  let fetchPriority: ImageFetchPriority = 'low'
  if (isPriority) {
    loading = 'eager'
    decoding = 'sync'
    fetchPriority = 'high'
  }

  return {
    alt,
    role,
    loading,
    decoding,
    fetchPriority,
  }
}

export type NonTransformableImageOptions = Prettify<NonTransformableImageSourceOptions & ImageNonSourceOptions>

export type NonTransformableImageProps = Prettify<NonTransformableImageSourceProps & ImageNonSourceProps>

export function getNonTransformableImageProps(options: NonTransformableImageOptions): NonTransformableImageProps {
  return {
    ...getNonTransformableImageSourceProps(options),
    ...getImageNonSourceProps(options),
  }
}

export type ImageOptions = Prettify<ImageSourceOptions & ImageNonSourceOptions>

export type ImageProps = Prettify<ImageSourceProps & ImageNonSourceProps>

export function transformImagePropsToHTMLProps({
  alt,
  role,
  loading,
  decoding,
  fetchPriority,
  ...nonSourceProps
}: ImageProps): Record<string, string> {
  return {
    ...transformImageSourcePropsToHTMLProps(nonSourceProps),
    ...transformImageNoneSourcePropsToHTMLProps({ alt, role, loading, decoding, fetchPriority }),
  }
}

export function getImageProps(options: ImageOptions): ImageProps {
  return {
    ...getImageSourceProps(options),
    ...getImageNonSourceProps(options),
  }
}

export type PictureSourceOptions = Prettify<
  Omit<ImageSourceOptions, 'transformer' | 'cropOptions' | 'format'> & {
    formats?: OutputImageFormat[]
    minWidth?: number
    maxWidth?: number
  }
>

function normalizeOutputImageFormats({ src, formats }: PictureSourceOptions): OutputImageFormat[] {
  const finalFormats: OutputImageFormat[] = formats && formats.length > 0 ? formats : ['avif', 'webp']
  const extname = getExtension(src)
  const fallbackFormat: OutputImageFormat = OUTPUT_IMAGE_FORMATS.includes(extname as OutputImageFormat)
    ? (extname as OutputImageFormat)
    : 'png'
  return finalFormats.includes(fallbackFormat) ? finalFormats : [...finalFormats, fallbackFormat]
}

function getPictureSourceOptionsMediaAttribute({ minWidth, maxWidth }: PictureSourceOptions): string {
  const queries: string[] = []
  if (minWidth) {
    queries.push(`(min-width: ${minWidth}px)`)
  }
  if (maxWidth) {
    queries.push(`(max-width: ${maxWidth}px)`)
  }
  return queries.join(' and ')
}

export type PictureOptions = Prettify<
  ImageNonSourceOptions & {
    sources: PictureSourceOptions[]
    transformer: TransformImageSrcFn
    cropOptions?: CropOptions
  }
>

export type PictureSourceProps = Prettify<
  ImageSourceProps & {
    media?: string
    type?: string
  }
>

export function transformPictureSourcePropsToHTMLProps({
  media,
  type,
  ...nonSourceProps
}: PictureSourceProps): Record<string, string> {
  const props = transformImageSourcePropsToHTMLProps(nonSourceProps)
  if (media) {
    props['media'] = media
  }
  if (type) {
    props['type'] = type
  }
  return props
}

export type PictureProps = {
  sources: PictureSourceProps[]
  image: ImageProps
}

export function getPictureProps({
  sources,
  transformer,
  cropOptions,
  ...nonSourceProps
}: PictureOptions): PictureProps {
  const sourcePropsList = sources.flatMap((sourceOptions) => {
    const finalFormats = normalizeOutputImageFormats(sourceOptions)
    return finalFormats.map((format) => {
      const sourceProps = getImageSourceProps({
        ...sourceOptions,
        transformer,
        cropOptions,
        format,
      })
      return {
        ...sourceProps,
        media: getPictureSourceOptionsMediaAttribute(sourceOptions),
        type: mime.getType(format) || '',
      }
    })
  })

  const lastSourceProps = sourcePropsList[sources.length - 1]!
  return {
    sources: sourcePropsList,
    image: {
      ...lastSourceProps,
      ...getImageNonSourceProps(nonSourceProps),
    },
  }
}
