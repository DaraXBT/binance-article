// Lives under scripts/ (not next to its subject in .agents/) because
// vitest.config.ts excludes .agents/** — the skill tree runs its own Bun
// suite; this file is the app-side contract test for the shared crop code.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BINANCE_COVER_HEIGHT,
  BINANCE_COVER_JPEG_QUALITY,
  BINANCE_COVER_MAX_BYTES,
  BINANCE_COVER_WIDTH,
  parsePrepareBinanceCoverArgs,
  prepareBinanceCover,
  runPrepareBinanceCoverCli,
} from '../.agents/skills/baoyu-cover-image/scripts/prepare-binance-cover';

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'prepare-binance-cover-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function createSource(
  path: string,
  format: 'jpeg' | 'png' | 'webp',
  width = 1_600,
  height = 900,
) {
  const image = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 18, g: 113, b: 202 },
    },
  });

  if (format === 'jpeg') await image.jpeg({ quality: 88 }).toFile(path);
  if (format === 'png') await image.png().toFile(path);
  if (format === 'webp') await image.webp({ quality: 88 }).toFile(path);
}

async function createStripedSource(
  path: string,
  width: number,
  height: number,
  direction: 'horizontal' | 'vertical',
) {
  const first = direction === 'horizontal'
    ? '<rect width="33.34%" height="100%" fill="#ef4444" />'
    : '<rect width="100%" height="33.34%" fill="#ef4444" />';
  const second = direction === 'horizontal'
    ? '<rect x="33.33%" width="33.34%" height="100%" fill="#22c55e" />'
    : '<rect y="33.33%" width="100%" height="33.34%" fill="#22c55e" />';
  const third = direction === 'horizontal'
    ? '<rect x="66.66%" width="33.34%" height="100%" fill="#3b82f6" />'
    : '<rect y="66.66%" width="100%" height="33.34%" fill="#3b82f6" />';
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      first + second + third +
    '</svg>',
  );
  await sharp(svg).png().toFile(path);
}

describe('prepareBinanceCover', () => {
  it.each(['jpeg', 'png', 'webp'] as const)(
    'converts a %s source into an exact Binance JPEG cover',
    async (format) => {
      const inputPath = join(directory, `source.${format}`);
      const outputPath = join(directory, `${format}-cover.jpg`);
      await createSource(inputPath, format);
      const sourceBefore = await readFile(inputPath);

      const result = await prepareBinanceCover({ inputPath, outputPath });

      const sourceAfter = await readFile(inputPath);
      const output = await readFile(outputPath);
      const metadata = await sharp(output).metadata();
      expect(sourceAfter).toEqual(sourceBefore);
      expect(output.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
      expect(output.byteLength).toBeLessThanOrEqual(BINANCE_COVER_MAX_BYTES);
      expect(metadata).toMatchObject({
        format: 'jpeg',
        width: BINANCE_COVER_WIDTH,
        height: BINANCE_COVER_HEIGHT,
      });
      expect(result).toMatchObject({
        inputPath,
        outputPath,
        bytes: output.byteLength,
        width: BINANCE_COVER_WIDTH,
        height: BINANCE_COVER_HEIGHT,
      });
      expect(BINANCE_COVER_JPEG_QUALITY).toBe(92);
    },
  );

  it('uses a deterministic centered crop by default and quality 92 encoding', async () => {
    const inputPath = join(directory, 'center-source.png');
    const defaultOutputPath = join(directory, 'default.jpg');
    const explicitOutputPath = join(directory, 'explicit.jpg');
    const repeatedOutputPath = join(directory, 'repeated.jpg');
    await createStripedSource(inputPath, 2_400, 400, 'horizontal');

    await prepareBinanceCover({ inputPath, outputPath: defaultOutputPath });
    await prepareBinanceCover({
      inputPath,
      outputPath: explicitOutputPath,
      focalX: 0.5,
      focalY: 0.5,
    });
    await prepareBinanceCover({ inputPath, outputPath: repeatedOutputPath });

    const defaultOutput = await readFile(defaultOutputPath);
    expect(defaultOutput).toEqual(await readFile(explicitOutputPath));
    expect(defaultOutput).toEqual(await readFile(repeatedOutputPath));

    const source = await readFile(inputPath);
    const oriented = await sharp(source).rotate().toBuffer({ resolveWithObject: true });
    const expected = await sharp(oriented.data)
      .extract({ left: 700, top: 0, width: 1_000, height: 400 })
      .resize(BINANCE_COVER_WIDTH, BINANCE_COVER_HEIGHT, { fit: 'fill' })
      .jpeg({ quality: 92, mozjpeg: true })
      .toBuffer();
    expect(defaultOutput).toEqual(expected);
  });

  it('clamps horizontal and vertical focal values to the image bounds', async () => {
    const horizontalPath = join(directory, 'horizontal.png');
    const verticalPath = join(directory, 'vertical.png');
    await createStripedSource(horizontalPath, 2_400, 400, 'horizontal');
    await createStripedSource(verticalPath, 1_000, 1_200, 'vertical');

    const cases = [
      { inputPath: horizontalPath, focalKey: 'focalX' as const, prefix: 'x' },
      { inputPath: verticalPath, focalKey: 'focalY' as const, prefix: 'y' },
    ];

    for (const { inputPath, focalKey, prefix } of cases) {
      const paths = {
        below: join(directory, `${prefix}-below.jpg`),
        zero: join(directory, `${prefix}-zero.jpg`),
        above: join(directory, `${prefix}-above.jpg`),
        one: join(directory, `${prefix}-one.jpg`),
      };
      await prepareBinanceCover({ inputPath, outputPath: paths.below, [focalKey]: -1 });
      await prepareBinanceCover({ inputPath, outputPath: paths.zero, [focalKey]: 0 });
      await prepareBinanceCover({ inputPath, outputPath: paths.above, [focalKey]: 2 });
      await prepareBinanceCover({ inputPath, outputPath: paths.one, [focalKey]: 1 });

      const zero = await readFile(paths.zero);
      const one = await readFile(paths.one);
      expect(await readFile(paths.below)).toEqual(zero);
      expect(await readFile(paths.above)).toEqual(one);
      expect(zero).not.toEqual(one);
    }
  });

  it('rejects the same input and output path without changing the source', async () => {
    const inputPath = join(directory, 'same.png');
    await createSource(inputPath, 'png');
    const sourceBefore = await readFile(inputPath);

    await expect(prepareBinanceCover({ inputPath, outputPath: inputPath }))
      .rejects.toThrow('Input and output paths must be different.');
    expect(await readFile(inputPath)).toEqual(sourceBefore);
  });

  it('reports a missing input path clearly', async () => {
    await expect(prepareBinanceCover({
      inputPath: join(directory, 'missing.png'),
      outputPath: join(directory, 'cover.jpg'),
    })).rejects.toThrow(/Input image not found/);
  });

  it('reports invalid image input clearly and does not create output', async () => {
    const inputPath = join(directory, 'invalid.png');
    const outputPath = join(directory, 'cover.jpg');
    await writeFile(inputPath, 'not an image');

    await expect(prepareBinanceCover({ inputPath, outputPath }))
      .rejects.toThrow(/Invalid input image/);
    await expect(readFile(outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('prepare Binance cover CLI', () => {
  it('parses required paths and clamps finite focal values', () => {
    expect(parsePrepareBinanceCoverArgs([
      '--input', 'source.png',
      '--output', 'cover.jpg',
      '--focal-x', '-1',
      '--focal-y', '2',
    ])).toEqual({
      inputPath: 'source.png',
      outputPath: 'cover.jpg',
      focalX: 0,
      focalY: 1,
    });
  });

  it.each([
    { args: [], message: '--input is required' },
    { args: ['--input', 'source.png'], message: '--output is required' },
    { args: ['--input'], message: '--input requires a value' },
    {
      args: ['--input', 'source.png', '--output', 'cover.jpg', '--focal-x', 'NaN'],
      message: '--focal-x must be a finite number',
    },
    {
      args: ['--input', 'source.png', '--output', 'cover.jpg', '--focal-y', 'Infinity'],
      message: '--focal-y must be a finite number',
    },
    {
      args: ['--input', 'source.png', '--output', 'cover.jpg', '--unknown'],
      message: 'Unknown argument: --unknown',
    },
  ])('rejects invalid arguments: $message', ({ args, message }) => {
    expect(() => parsePrepareBinanceCoverArgs(args)).toThrow(message);
  });

  it('runs the processor and prints the prepared output path', async () => {
    const prepare = vi.fn().mockResolvedValue({
      inputPath: '/tmp/source.png',
      outputPath: '/tmp/cover.jpg',
      bytes: 123,
      width: BINANCE_COVER_WIDTH,
      height: BINANCE_COVER_HEIGHT,
    });
    const log = vi.fn();
    const error = vi.fn();

    await expect(runPrepareBinanceCoverCli({
      argv: ['--input', '/tmp/source.png', '--output', '/tmp/cover.jpg'],
      prepare,
      log,
      error,
    })).resolves.toBe(0);
    expect(prepare).toHaveBeenCalledWith({
      inputPath: '/tmp/source.png',
      outputPath: '/tmp/cover.jpg',
      focalX: 0.5,
      focalY: 0.5,
    });
    expect(log).toHaveBeenCalledWith('Prepared Binance cover: /tmp/cover.jpg');
    expect(error).not.toHaveBeenCalled();
  });

  it('returns a nonzero status and prints a concise processing error', async () => {
    const log = vi.fn();
    const error = vi.fn();
    const prepare = vi.fn().mockRejectedValue(new Error('Input image not found: missing.png'));

    await expect(runPrepareBinanceCoverCli({
      argv: ['--input', 'missing.png', '--output', 'cover.jpg'],
      prepare,
      log,
      error,
    })).resolves.toBe(1);
    expect(log).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith('Input image not found: missing.png');
  });
});
