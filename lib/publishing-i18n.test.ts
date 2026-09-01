import { describe, expect, it } from 'vitest';

import { assembleBinanceArticle, getBinanceExportIssues } from './binance-export';
import type { Language } from './i18n';
import { publishingTranslations } from './publishing-i18n';
import { getXPostExportIssues } from './x-export';

const languages = ['en', 'km', 'id', 'lo', 'my', 'th', 'fil'] as const satisfies readonly Language[];
const translatedLanguages = languages.filter((language) => language !== 'en');

function nestedKeys(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return [];

  return Object.entries(value).flatMap(([key, nestedValue]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return nestedValue !== null && typeof nestedValue === 'object'
      ? [path, ...nestedKeys(nestedValue, path)]
      : [path];
  }).sort();
}

describe('publishing translations', () => {
  it('keeps the complete nested message contract identical across every supported language', () => {
    expect(Object.keys(publishingTranslations).sort()).toEqual([...languages].sort());

    const englishKeys = nestedKeys(publishingTranslations.en);
    for (const language of languages) {
      expect(nestedKeys(publishingTranslations[language]), language).toEqual(englishKeys);
    }
  });

  it.each(translatedLanguages)('does not silently use English publishing review fallbacks for %s', (language) => {
    const messages = publishingTranslations[language];
    const english = publishingTranslations.en;

    // These are ordinary interface labels rather than product names, so an
    // exact English match here would indicate a catalog fallback leaking into
    // the selected language.
    expect(messages.cover.title).not.toBe(english.cover.title);
    expect(messages.command.failed).not.toBe(english.command.failed);
    expect(messages.binance.dialogTitle).not.toBe(english.binance.dialogTitle);
    expect(messages.x.dialogTitle).not.toBe(english.x.dialogTitle);
    expect(messages.review.editDraft).not.toBe(english.review.editDraft);
  });

  it('uses Filipino safe-frame and preview wording without changing product identifiers', () => {
    const filipino = publishingTranslations.fil;

    expect(filipino.cover.safeFrame).toBe('5:2 ligtas na frame');
    expect(filipino.cover.previewAlt).toContain('Paunang tingin');
    expect(filipino.binance.coverPreviewAlt).toBe('Paunang tingin sa nakalaang Binance cover');
    expect(filipino.review.previewPost).toBe('Tingnan muna ang post');
    expect(filipino.review.xArticleCoverPreview).toContain('X');
  });

  it.each(languages)('interpolates dynamic publishing copy for %s', (language) => {
    const messages = publishingTranslations[language];

    expect(messages.binance.characters(7, 90)).toContain('7');
    expect(messages.binance.characters(7, 90)).toContain('90');
    expect(messages.binance.assetSummary(3, 2)).toContain('3');
    expect(messages.binance.assetSummary(3, 2)).toContain('2');
    expect(messages.binance.tagSummary(5)).toContain('5');
    expect(messages.binance.assetRequestFailed(503)).toContain('503');
    expect(messages.binance.titleTooLong(70)).toContain('70');
    expect(messages.binance.slideNoImage(4)).toContain('4');
    expect(messages.binance.slideUsesCopy(6)).toContain('6');
    expect(messages.binance.slideNoCopy(8)).toContain('8');
    expect(messages.x.usePost(2)).toContain('2');
    expect(messages.x.post(3)).toContain('3');
    expect(messages.x.characters(7, 90)).toContain('7');
    expect(messages.x.characters(7, 90)).toContain('90');
    expect(messages.x.useImage('Hero')).toContain('Hero');
    expect(messages.x.assetRequestFailed(429)).toContain('429');
    expect(messages.x.maxImages(4)).toContain('4');
    expect(messages.x.textTooLong(280)).toContain('280');
    expect(messages.review.characterCount('7', '90')).toContain('7');
    expect(messages.review.characterCount('7', '90')).toContain('90');
    expect(messages.review.mediaCount('3', '4')).toContain('3');
    expect(messages.review.mediaCount('3', '4')).toContain('4');
    expect(messages.review.binancePostTextTooLong('280')).toContain('280');
    expect(messages.review.xArticleTitleTooLong('100')).toContain('100');
  });

  it.each(languages)('drives visible publishing validation in %s', (language) => {
    const messages = publishingTranslations[language];
    const binanceIssues = getBinanceExportIssues({
      title: '',
      markdown: '',
      coverSlideId: null,
      slides: [{ id: 'slide-1', imageUrl: null, imageStatus: 'failed', imagePath: null }],
    }, messages.binance);
    const article = assembleBinanceArticle({
      slides: [{ id: 'slide-1', title: 'Topic', imagePath: null }],
    }, messages.binance);
    const xIssues = getXPostExportIssues({ text: '', selectedImageCount: 0 }, messages.x);

    expect(binanceIssues.errors).toContain(messages.binance.titleRequired);
    expect(binanceIssues.errors).toContain(messages.binance.markdownRequired);
    expect(binanceIssues.errors).toContain(messages.binance.coverRequired);
    expect(binanceIssues.warnings).toContain(messages.binance.slideNoImage(1));
    expect(article.warnings).toContain(messages.binance.slideNoCopy(1));
    expect(article.warnings).toContain(messages.binance.slideNoImage(1));
    expect(xIssues.errors).toContain(messages.x.contentRequired);
  });

  it.each(languages)('provides the review surface for %s', (language) => {
    const messages = publishingTranslations[language];

    expect(messages.articlePage.reviewAndPublish.trim()).not.toBe('');
    expect(messages.review.destinationLabel.trim()).not.toBe('');
    expect(messages.review.formatLabel.trim()).not.toBe('');
    expect(messages.review.reviewViewLabel.trim()).not.toBe('');
    expect(messages.review.saveDraft.trim()).not.toBe('');
  });
});
