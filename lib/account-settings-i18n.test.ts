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
