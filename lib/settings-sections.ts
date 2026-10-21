export const SETTINGS_SECTION_IDS = ['general', 'ai', 'publishing', 'access'] as const;
export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];

/**
 * Maps the `settings` URL value to an Account settings section. `connections`
 * is the original value and still opens the dialog on its default section.
 */
export function parseSettingsSection(value: unknown): SettingsSectionId | 'default' | null {
  if (value === 'connections') return 'default';
  return SETTINGS_SECTION_IDS.find((id) => id === value) ?? null;
}
