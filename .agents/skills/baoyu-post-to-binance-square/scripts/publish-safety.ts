import { randomUUID } from 'node:crypto';

export interface CompositionReport {
  titleMatches: boolean;
  bodyMatches: boolean;
  expectedImages: number;
  actualImages: number;
  remainingPlaceholders: string[];
  expectedCodeBlocks: number;
  actualCodeBlocks: number;
}

export function assertCompositionReady(report: CompositionReport): void {
  const failures: string[] = [];
  if (!report.titleMatches) failures.push('title does not match the prepared draft');
  if (!report.bodyMatches) failures.push('body does not match the prepared draft');
  if (report.actualImages !== report.expectedImages) {
    failures.push(`image count ${report.actualImages}/${report.expectedImages}`);
  }
  if (report.actualCodeBlocks !== report.expectedCodeBlocks) {
    failures.push(`code block count ${report.actualCodeBlocks}/${report.expectedCodeBlocks}`);
  }
  if (report.remainingPlaceholders.length > 0) {
    failures.push(`remaining placeholders: ${report.remainingPlaceholders.join(', ')}`);
  }
  if (failures.length > 0) {
    throw new Error(`Article composition failed: ${failures.join('; ')}.`);
  }
}

export interface PublishEvidenceInput {
  beforeUrl: string;
  afterUrl: string;
  successToast: boolean;
  editorVisible: boolean;
}

export interface PublishEvidence {
  verified: boolean;
  reason: string;
  publishedUrl?: string;
}

function isBinanceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && /(^|\.)binance\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
}

function isPublishedUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return isBinanceUrl(value) && /\/square\/(?:post|article)\//i.test(url.pathname);
  } catch {
    return false;
  }
}

export function evaluatePublishEvidence(input: PublishEvidenceInput): PublishEvidence {
  if (!isBinanceUrl(input.afterUrl)) {
    return { verified: false, reason: 'The browser did not remain on a Binance page.' };
  }
  if (isPublishedUrl(input.afterUrl) && input.afterUrl !== input.beforeUrl) {
    return {
      verified: true,
      reason: 'Binance navigated to a canonical published article URL.',
      publishedUrl: input.afterUrl,
    };
  }
  if (input.successToast && !input.editorVisible) {
    return { verified: true, reason: 'Binance displayed a success state and closed the editor.' };
  }
  return { verified: false, reason: 'Publish was clicked, but Binance success could not be verified.' };
}

export function createPlaceholderNamespace(): string {
  const random = randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase();
  return `BS_${random}_`;
}

export function makePlaceholder(namespace: string, kind: 'IMG' | 'CODE', index: number): string {
  if (!/^BS_[A-Z0-9]{16}_$/.test(namespace)) throw new Error('Invalid placeholder namespace.');
  if (!Number.isInteger(index) || index < 1) throw new Error('Placeholder index must be positive.');
  return `${namespace}${kind}_${index}`;
}
