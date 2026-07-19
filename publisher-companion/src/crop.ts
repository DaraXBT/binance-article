import sharp from 'sharp';

function calculateCrop(
  width: number,
  height: number,
  focalX: number,
  focalY: number,
) {
  const targetRatio = 2.5;
  let sourceWidth = width;
  let sourceHeight = Math.floor(width / targetRatio);
  if (sourceHeight > height) {
    sourceHeight = height;
    sourceWidth = Math.floor(height * targetRatio);
  }
  sourceWidth = Math.max(1, sourceWidth);
  sourceHeight = Math.max(1, sourceHeight);
  return {
    left: Math.min(
      Math.max(0, Math.round((width - sourceWidth) * Math.min(1, Math.max(0, focalX)))),
      width - sourceWidth,
    ),
    top: Math.min(
      Math.max(0, Math.round((height - sourceHeight) * Math.min(1, Math.max(0, focalY)))),
      height - sourceHeight,
    ),
    width: sourceWidth,
    height: sourceHeight,
  };
}

export async function cropBinanceCover(input: {
  bytes: Uint8Array;
  focalX: number;
  focalY: number;
  maxInputPixels?: number;
}): Promise<Uint8Array> {
  const maxInputPixels = input.maxInputPixels ?? 40_000_000;
  if (!Number.isSafeInteger(maxInputPixels) || maxInputPixels <= 0) {
    throw new Error('Cover decode pixel limit is invalid.');
  }
  const oriented = await sharp(input.bytes, {
    failOn: 'error',
    limitInputPixels: maxInputPixels,
  }).rotate().toBuffer({ resolveWithObject: true });
  const { width, height } = oriented.info;
  if (!width || !height) throw new Error('Cover dimensions are unavailable.');
  const crop = calculateCrop(width, height, input.focalX, input.focalY);
  const output = await sharp(oriented.data, {
    failOn: 'error',
    limitInputPixels: maxInputPixels,
  })
    .extract(crop)
    .resize(1000, 400, { fit: 'fill' })
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();
  return new Uint8Array(output);
}
