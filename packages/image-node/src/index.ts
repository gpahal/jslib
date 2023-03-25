import { OUTPUT_IMAGE_FORMATS } from "@gpahal/image";
import sharp from "sharp";

import type {
  TransformImageBufferRequest,
  TransformImageBufferResponse,
  OutputImageFormat,
  TransformImageBufferFn,
} from "@gpahal/image";

export const transformImageBuffer: TransformImageBufferFn = async (
  request: TransformImageBufferRequest,
): Promise<TransformImageBufferResponse> => {
  let image = sharp(request.src, { pages: -1 });
  image = image.rotate();

  if (request.width != null && request.height != null) {
    const width = Math.round(request.width);
    const height = Math.round(request.height);
    image.resize({
      width,
      height,
    });
  }

  if (request.format && OUTPUT_IMAGE_FORMATS.includes(request.format)) {
    image.toFormat(request.format, { quality: request.quality });
  }

  const { data: output, info } = await image.toBuffer({ resolveWithObject: true });
  return {
    output,
    format: info.format as OutputImageFormat,
    width: info.width,
    height: info.height,
  };
};
