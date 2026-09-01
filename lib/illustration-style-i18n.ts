import type { IllustrationStyleId } from '@/lib/config';
import { translations, type Language } from '@/lib/i18n';

export type IllustrationStyleCopy = {
  name: string;
  description: string;
};

type IllustrationStyleCopyCatalog = Record<
  Language,
  Record<IllustrationStyleId, IllustrationStyleCopy>
>;

// `ILLUSTRATION_STYLES` is the stable wire contract used in requests and
// persisted drafts. Keep display copy separate so the UI can change language
// without changing a selected style ID.
export const ILLUSTRATION_STYLE_COPY: IllustrationStyleCopyCatalog = {
  en: translations.en.newDeck.styleOptions,
  km: translations.km.newDeck.styleOptions,
  id: translations.id.newDeck.styleOptions,
  lo: translations.lo.newDeck.styleOptions,
  my: translations.my.newDeck.styleOptions,
  th: translations.th.newDeck.styleOptions,
  fil: translations.fil.newDeck.styleOptions,
};

export function getIllustrationStyleCopy(
  language: Language,
  styleId: IllustrationStyleId,
): IllustrationStyleCopy {
  return ILLUSTRATION_STYLE_COPY[language][styleId];
}
