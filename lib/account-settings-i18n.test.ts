import { describe, expect, it } from 'vitest';

import {
  accountSettingsErrorMessage,
  accountSettingsTranslations,
  formatAccountSettingsDate,
  getAccountSettingsCopy,
} from './account-settings-i18n';
import { SettingsApiError } from './settings-api';

describe('account settings translations', () => {
  it('keeps every visible Account Settings message available in all seven locales', () => {
    const englishKeys = Object.keys(accountSettingsTranslations.en).sort();

    for (const [language, messages] of Object.entries(accountSettingsTranslations)) {
      expect(Object.keys(messages).sort(), language).toEqual(englishKeys);
    }
  });

  it('returns locale-specific copy and date formatting', () => {
    const english = getAccountSettingsCopy('en');
    const khmer = getAccountSettingsCopy('km');

    expect(khmer.t('accountSettings')).not.toBe(english.t('accountSettings'));
    expect(formatAccountSettingsDate('km', '2026-08-31T00:00:00.000Z', khmer.t('notYet')))
      .not.toBe(formatAccountSettingsDate('en', '2026-08-31T00:00:00.000Z', english.t('notYet')));
  });

  it('uses localized Myanmar and Filipino labels while keeping product and command IDs intact', () => {
    const myanmar = getAccountSettingsCopy('my');
    const filipino = getAccountSettingsCopy('fil');

    expect(myanmar.t('platformCredits')).toBe('ပလက်ဖောင်း ခရက်ဒစ်များ');
    expect(myanmar.t('companionCommands')).toBe('တွဲဖက်အက်ပ် အမိန့်များ');
    expect(myanmar.t('companionCommandsDescription')).toContain('pair');

    expect(filipino.t('account')).toBe('Akawnt');
    expect(filipino.t('publisherDevice', { name: 'MacBook' })).toBe('Aparato sa pag-publish MacBook');
    expect(filipino.t('enrollmentCode')).toBe('Code sa pagpapatala');
    expect(filipino.t('protocol', { version: 2 })).toBe('Protokol v2');
    expect(filipino.t('browserPublisherDescription')).toContain('Binance Square');
  });

  it('uses localized recovery messages instead of raw API error bodies', () => {
    const copy = getAccountSettingsCopy('th');
    const error = new SettingsApiError('Raw upstream response', {
      status: 503,
      code: 'UNEXPECTED_PROXY_FAILURE',
    });

    expect(accountSettingsErrorMessage(error, copy, 'peopleCouldNotLoad'))
      .toBe(copy.t('peopleCouldNotLoad'));
  });
});
