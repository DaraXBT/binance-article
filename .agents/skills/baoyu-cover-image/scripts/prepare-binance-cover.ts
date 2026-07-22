import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import sharp, { type Metadata, type OutputInfo } from 'sharp';

export const BINANCE_COVER_WIDTH = 1_000;
export const BINANCE_COVER_HEIGHT = 400;
export const BINANCE_COVER_JPEG_QUALITY = 92;
export const BINANCE_COVER_MAX_BYTES = 10 * 1024 * 1024;

const BINANCE_COVER_RATIO = BINANCE_COVER_WIDTH / BINANCE_COVER_HEIGHT;
const DEFAULT_FOCAL_POINT = 0.5;
const MAX_INPUT_PIXELS = 40_000_000;

export type PrepareBinanceCoverOptions = {
  inputPath: string;
  outputPath: string;
  focalX?: number;
  focalY?: number;
};

export type PreparedBinanceCover = {
  inputPath: string;
  outputPath: string;
  bytes: number;
  width: typeof BINANCE_COVER_WIDTH;
  height: typeof BINANCE_COVER_HEIGHT;
};

function clampFocalPoint(value: number, optionName: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${optionName} must be a finite number.`);
  }
  return Math.min(1, Math.max(0, value));
}

function getFileErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

function calculateCrop(width: number, height: number, focalX: number, focalY: number) {
  let sourceWidth = width;
  let sourceHeight = Math.floor(width / BINANCE_COVER_RATIO);
  if (sourceHeight > height) {
    sourceHeight = height;
    sourceWidth = Math.floor(height * BINANCE_COVER_RATIO);
  }

  sourceWidth = Math.max(1, sourceWidth);
  sourceHeight = Math.max(1, sourceHeight);
  const left = Math.round((width - sourceWidth) * focalX);
  const top = Math.round((height - sourceHeight) * focalY);

  return {
    left: Math.min(Math.max(0, left), width - sourceWidth),
    top: Math.min(Math.max(0, top), height - sourceHeight),
    width: sourceWidth,
    height: sourceHeight,
  };
}

async function validateCoverBytes(output: Buffer): Promise<void> {
  const hasJpegSignature = output.byteLength >= 3 &&
    output[0] === 0xff &&
    output[1] === 0xd8 &&
    output[2] === 0xff;
  if (!hasJpegSignature) {
    throw new Error('Generated cover is not a valid JPEG.');
  }
  if (output.byteLength > BINANCE_COVER_MAX_BYTES) {
    throw new Error('Generated cover exceeds the 10 MiB limit.');
  }

  let metadata: Metadata;
  try {
    metadata = await sharp(output, { failOn: 'error' }).metadata();
  } catch {
    throw new Error('Generated cover is not a readable JPEG.');
  }
  if (
    metadata.format !== 'jpeg' ||
    metadata.width !== BINANCE_COVER_WIDTH ||
    metadata.height !== BINANCE_COVER_HEIGHT
  ) {
    throw new Error('Generated cover must be a 1000x400 JPEG.');
  }
}

async function writeOutputAtomically(outputPath: string, output: Buffer): Promise<void> {
  const temporaryPath = join(
    dirname(outputPath),
    `.${basename(outputPath)}.${process.pid}.${randomUUID()}.tmp`,
  );

  try {
    await writeFile(temporaryPath, output, { flag: 'wx' });
    await rename(temporaryPath, outputPath);
  } catch {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw new Error(`Could not write output image: ${outputPath}`);
  }
}

export async function prepareBinanceCover(
  options: PrepareBinanceCoverOptions,
): Promise<PreparedBinanceCover> {
  const inputPath = resolve(options.inputPath);
  const outputPath = resolve(options.outputPath);
  if (inputPath === outputPath) {
    throw new Error('Input and output paths must be different.');
  }

  const focalX = clampFocalPoint(options.focalX ?? DEFAULT_FOCAL_POINT, 'focalX');
  const focalY = clampFocalPoint(options.focalY ?? DEFAULT_FOCAL_POINT, 'focalY');

  let input: Buffer;
  try {
    input = await readFile(inputPath);
  } catch (error) {
    if (getFileErrorCode(error) === 'ENOENT') {
      throw new Error(`Input image not found: ${inputPath}`);
    }
    throw new Error(`Could not read input image: ${inputPath}`);
  }

  let oriented: { data: Buffer; info: OutputInfo };
  try {
    oriented = await sharp(input, {
      failOn: 'error',
      limitInputPixels: MAX_INPUT_PIXELS,
    }).rotate().toBuffer({ resolveWithObject: true });
  } catch {
    throw new Error(`Invalid input image: ${inputPath}`);
  }

  const { width, height } = oriented.info;
  if (!width || !height) {
    throw new Error(`Invalid input image dimensions: ${inputPath}`);
  }

  let output: Buffer;
  try {
    output = await sharp(oriented.data, {
      failOn: 'error',
      limitInputPixels: MAX_INPUT_PIXELS,
    })
      .extract(calculateCrop(width, height, focalX, focalY))
      .resize(BINANCE_COVER_WIDTH, BINANCE_COVER_HEIGHT, { fit: 'fill' })
      .jpeg({ quality: BINANCE_COVER_JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
  } catch {
    throw new Error(`Could not prepare Binance cover: ${inputPath}`);
  }

  await validateCoverBytes(output);
  await writeOutputAtomically(outputPath, output);

  return {
    inputPath,
    outputPath,
    bytes: output.byteLength,
    width: BINANCE_COVER_WIDTH,
    height: BINANCE_COVER_HEIGHT,
  };
}

export type PrepareBinanceCoverArguments = {
  inputPath: string;
  outputPath: string;
  focalX: number;
  focalY: number;
};

function readOptionValue(argv: readonly string[], index: number, option: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

export function parsePrepareBinanceCoverArgs(
  argv: readonly string[],
): PrepareBinanceCoverArguments {
  let inputPath: string | undefined;
  let outputPath: string | undefined;
  let focalX = DEFAULT_FOCAL_POINT;
  let focalY = DEFAULT_FOCAL_POINT;

  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === '--input') {
      inputPath = readOptionValue(argv, index, option);
      index += 1;
    } else if (option === '--output') {
      outputPath = readOptionValue(argv, index, option);
      index += 1;
    } else if (option === '--focal-x' || option === '--focal-y') {
      const rawValue = readOptionValue(argv, index, option);
      const parsedValue = Number(rawValue);
      const value = clampFocalPoint(parsedValue, option);
      if (option === '--focal-x') focalX = value;
      else focalY = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${option}`);
    }
  }

  if (!inputPath) throw new Error('--input is required.');
  if (!outputPath) throw new Error('--output is required.');
  return { inputPath, outputPath, focalX, focalY };
}

type PrepareBinanceCoverCliOptions = {
  argv?: readonly string[];
  prepare?: typeof prepareBinanceCover;
  log?: (message: string) => void;
  error?: (message: string) => void;
};

export async function runPrepareBinanceCoverCli({
  argv = process.argv.slice(2),
  prepare = prepareBinanceCover,
  log = console.log,
  error = console.error,
}: PrepareBinanceCoverCliOptions = {}): Promise<number> {
  try {
    const result = await prepare(parsePrepareBinanceCoverArgs(argv));
    log(`Prepared Binance cover: ${result.outputPath}`);
    return 0;
  } catch (caught) {
    error(caught instanceof Error ? caught.message : 'Could not prepare Binance cover.');
    return 1;
  }
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  void runPrepareBinanceCoverCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
