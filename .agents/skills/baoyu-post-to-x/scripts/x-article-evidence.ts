export type ReviewedXArticleBodyToken =
  | { kind: 'text'; text: string }
  | { kind: 'media'; assetId: string };

export interface XArticleImageFingerprint {
  aspectRatio: number;
  differenceHash: string;
  colorSamples: number[];
  alphaSamples?: number[];
}

export type RenderedXArticleBodyToken =
  | { kind: 'text'; text: string }
  | {
    kind: 'media';
    blockId: string;
    source?: string;
    fingerprint: XArticleImageFingerprint;
  };

export interface XArticleMediaAssetBinding {
  blockId: string;
  assetId: string;
  fingerprint: XArticleImageFingerprint;
}

export interface XArticleScopedBlockCandidate {
  ownerEditorId: string;
  block: RenderedXArticleBodyToken;
}

export interface BindXArticleMediaAssetInput {
  blockId: string;
  assetId: string;
  reviewedFingerprint: XArticleImageFingerprint;
  renderedFingerprint: XArticleImageFingerprint;
}

export interface XArticleBodyMediaEvidence {
  reviewedSequence: readonly ReviewedXArticleBodyToken[];
  renderedSequence: readonly RenderedXArticleBodyToken[];
  verifiedAssetBindings: readonly XArticleMediaAssetBinding[];
}

type BoundXArticleBodyToken =
  | { kind: 'text'; text: string }
  | { kind: 'media'; assetId: string };

function requireNonemptyIdentity(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new Error(`X Article ${label} must be nonempty.`);
  }
}

/**
 * The browser and native clipboard may re-encode an image. Compare decoded,
 * down-sampled visual evidence with narrow tolerance instead of encoded bytes
 * or a raw source URL.
 */
export function xArticleImageFingerprintsMatch(
  expected: XArticleImageFingerprint,
  actual: XArticleImageFingerprint,
): boolean {
  const fingerprints = [expected, actual];
  if (fingerprints.some((fingerprint) => (
    !Number.isFinite(fingerprint.aspectRatio)
    || fingerprint.aspectRatio <= 0
    || !/^[a-f0-9]+$/i.test(fingerprint.differenceHash)
    || fingerprint.differenceHash.length < 16
    || fingerprint.differenceHash.length !== expected.differenceHash.length
    || fingerprint.colorSamples.length === 0
    || fingerprint.colorSamples.length !== expected.colorSamples.length
    || fingerprint.colorSamples.some((sample) => !Number.isInteger(sample) || sample < 0 || sample > 255)
    || (fingerprint.alphaSamples !== undefined && (
      fingerprint.alphaSamples.length === 0
      || fingerprint.alphaSamples.some(
        (sample) => !Number.isInteger(sample) || sample < 0 || sample > 255
      )
    ))
  ))) return false;
  if ((expected.alphaSamples === undefined) !== (actual.alphaSamples === undefined)) return false;
  if (
    expected.alphaSamples
    && actual.alphaSamples
    && expected.alphaSamples.length !== actual.alphaSamples.length
  ) return false;

  const ratioDelta = Math.abs(expected.aspectRatio - actual.aspectRatio)
    / Math.max(expected.aspectRatio, actual.aspectRatio);
  if (ratioDelta > 0.01) return false;

  let differingBits = 0;
  for (let index = 0; index < expected.differenceHash.length; index++) {
    const xor = Number.parseInt(expected.differenceHash[index]!, 16)
      ^ Number.parseInt(actual.differenceHash[index]!, 16);
    differingBits += xor.toString(2).replace(/0/g, '').length;
  }
  const bitCount = expected.differenceHash.length * 4;
  if (differingBits > Math.max(2, Math.floor(bitCount * 0.02))) return false;

  let absoluteColorDelta = 0;
  let largeColorDeltas = 0;
  for (let index = 0; index < expected.colorSamples.length; index++) {
    const delta = Math.abs(expected.colorSamples[index]! - actual.colorSamples[index]!);
    absoluteColorDelta += delta;
    if (delta > 16) largeColorDeltas += 1;
  }
  if (
    absoluteColorDelta / expected.colorSamples.length > 4
    || largeColorDeltas / expected.colorSamples.length > 0.02
  ) return false;

  if (expected.alphaSamples && actual.alphaSamples) {
    let absoluteAlphaDelta = 0;
    let largeAlphaDeltas = 0;
    for (let index = 0; index < expected.alphaSamples.length; index++) {
      const delta = Math.abs(expected.alphaSamples[index]! - actual.alphaSamples[index]!);
      absoluteAlphaDelta += delta;
      if (delta > 16) largeAlphaDeltas += 1;
    }
    if (
      absoluteAlphaDelta / expected.alphaSamples.length > 4
      || largeAlphaDeltas / expected.alphaSamples.length > 0.02
    ) return false;
  }
  return true;
}

export function bindXArticleMediaAsset({
  blockId,
  assetId,
  reviewedFingerprint,
  renderedFingerprint,
}: BindXArticleMediaAssetInput): XArticleMediaAssetBinding {
  requireNonemptyIdentity(blockId, 'media block ID');
  requireNonemptyIdentity(assetId, 'reviewed asset ID');

  if (!xArticleImageFingerprintsMatch(reviewedFingerprint, renderedFingerprint)) {
    throw new Error(
      'X Article media asset identity failed: rendered fingerprint does not match the reviewed image.',
    );
  }

  return { blockId, assetId, fingerprint: reviewedFingerprint };
}

function normalizeXArticleEvidenceText(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Normalizes browser-dependent text fragmentation while preserving every
 * media boundary. Empty text nodes are ignored and adjacent text nodes are
 * combined, so the comparison describes the observable text/media order
 * rather than incidental DraftJS DOM node boundaries.
 */
function normalizeBoundSequence(
  sequence: readonly BoundXArticleBodyToken[],
): BoundXArticleBodyToken[] {
  const normalized: BoundXArticleBodyToken[] = [];

  for (const token of sequence) {
    if (token.kind === 'media') {
      normalized.push(token);
      continue;
    }

    const text = normalizeXArticleEvidenceText(token.text);
    if (!text) continue;

    const previous = normalized.at(-1);
    if (previous?.kind === 'text') {
      previous.text = normalizeXArticleEvidenceText(`${previous.text} ${text}`);
    } else {
      normalized.push({ kind: 'text', text });
    }
  }

  return normalized;
}

function assertUniqueReviewedAssets(
  sequence: readonly ReviewedXArticleBodyToken[],
): void {
  const assets = new Set<string>();
  for (const token of sequence) {
    if (token.kind !== 'media') continue;
    requireNonemptyIdentity(token.assetId, 'reviewed asset ID');
    if (assets.has(token.assetId)) {
      throw new Error(`X Article media evidence contains duplicate reviewed asset binding: ${token.assetId}.`);
    }
    assets.add(token.assetId);
  }
}

function buildUniqueBindingMaps(
  bindings: readonly XArticleMediaAssetBinding[],
): {
  assetByBlockId: Map<string, string>;
  blockIdByAsset: Map<string, string>;
} {
  const assetByBlockId = new Map<string, string>();
  const blockIdByAsset = new Map<string, string>();

  for (const { blockId, assetId } of bindings) {
    requireNonemptyIdentity(blockId, 'media block ID');
    requireNonemptyIdentity(assetId, 'reviewed asset ID');

    if (assetByBlockId.has(blockId)) {
      const existingAsset = assetByBlockId.get(blockId);
      const detail = existingAsset === assetId ? 'duplicate' : 'conflicting';
      throw new Error(`X Article media evidence contains a ${detail} binding for block ${blockId}.`);
    }
    if (blockIdByAsset.has(assetId)) {
      throw new Error(`X Article media evidence binds reviewed asset ${assetId} to more than one media block.`);
    }

    assetByBlockId.set(blockId, assetId);
    blockIdByAsset.set(assetId, blockId);
  }

  return { assetByBlockId, blockIdByAsset };
}

/**
 * Proves that the editor contains the reviewed interleaved text/media order.
 * Rendered media is identified solely through its stable block ID and a
 * previously pixel-verified asset binding. The current source URL is ignored.
 */
export function assertXArticleBodyMediaEvidence({
  reviewedSequence,
  renderedSequence,
  verifiedAssetBindings,
}: XArticleBodyMediaEvidence): void {
  assertUniqueReviewedAssets(reviewedSequence);
  const { assetByBlockId } = buildUniqueBindingMaps(verifiedAssetBindings);
  const usedBlockIds = new Set<string>();

  const reviewed = normalizeBoundSequence(reviewedSequence);
  const rendered = normalizeBoundSequence(renderedSequence.map((token): BoundXArticleBodyToken => {
    if (token.kind === 'text') return token;

    requireNonemptyIdentity(token.blockId, 'media block ID');
    if (usedBlockIds.has(token.blockId)) {
      throw new Error(`X Article rendered media sequence contains duplicate block ${token.blockId}.`);
    }
    usedBlockIds.add(token.blockId);

    const assetId = assetByBlockId.get(token.blockId);
    if (!assetId) {
      throw new Error(`X Article rendered media block ${token.blockId} has no verified asset binding.`);
    }
    const binding = verifiedAssetBindings.find((candidate) => candidate.blockId === token.blockId);
    if (!binding || !xArticleImageFingerprintsMatch(binding.fingerprint, token.fingerprint)) {
      throw new Error(`X Article rendered media block ${token.blockId} no longer matches its reviewed asset fingerprint.`);
    }
    return { kind: 'media', assetId };
  }));

  if (usedBlockIds.size !== verifiedAssetBindings.length) {
    throw new Error('X Article media evidence contains an unused or conflicting verified asset binding.');
  }

  if (reviewed.length !== rendered.length) {
    throw new Error('X Article media sequence does not match the reviewed text/media sequence.');
  }

  for (let index = 0; index < reviewed.length; index++) {
    const expected = reviewed[index]!;
    const actual = rendered[index]!;
    if (expected.kind !== actual.kind) {
      throw new Error(`X Article media position does not match the reviewed sequence at token ${index + 1}.`);
    }
    if (expected.kind === 'text' && actual.kind === 'text' && expected.text !== actual.text) {
      throw new Error(`X Article text/media sequence does not match the reviewed body at token ${index + 1}.`);
    }
    if (expected.kind === 'media' && actual.kind === 'media' && expected.assetId !== actual.assetId) {
      throw new Error(`X Article media asset binding does not match the reviewed sequence at token ${index + 1}.`);
    }
  }
}

/** Returns only blocks owned by the exact selected editor instance. */
export function scopeXArticleBodySnapshot(
  editorId: string,
  candidates: readonly XArticleScopedBlockCandidate[],
): RenderedXArticleBodyToken[] {
  requireNonemptyIdentity(editorId, 'editor ID');
  return candidates
    .filter(({ ownerEditorId }) => ownerEditorId === editorId)
    .map(({ block }) => block);
}
