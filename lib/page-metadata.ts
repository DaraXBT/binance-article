import type { Language } from '@/lib/i18n';

type LocalizedMetadata = {
  title: string;
  description: string;
};

const metadataByLanguage: Record<Language, LocalizedMetadata> = {
  en: {
    title: 'xArticle — Binance Square article studio',
    description: 'Turn a market idea into a publish-ready Binance Square article.',
  },
  km: {
    title: 'xArticle — ស្ទូឌីយោអត្ថបទ Binance Square',
    description: 'បម្លែងគំនិតទីផ្សារទៅជាអត្ថបទ Binance Square ដែលរួចរាល់សម្រាប់បោះពុម្ព។',
  },
  id: {
    title: 'xArticle — studio artikel Binance Square',
    description: 'Ubah ide pasar menjadi artikel Binance Square yang siap diterbitkan.',
  },
  lo: {
    title: 'xArticle — ສະຕູດິໂອບົດຄວາມ Binance Square',
    description: 'ປ່ຽນແນວຄິດຕະຫຼາດໃຫ້ເປັນບົດຄວາມ Binance Square ທີ່ພ້ອມເຜີຍແຜ່.',
  },
  my: {
    title: 'xArticle — Binance Square ဆောင်းပါးစတူဒီယို',
    description: 'စျေးကွက်အကြံကို ထုတ်ဝေရန်အဆင်သင့်ရှိသော Binance Square ဆောင်းပါးအဖြစ် ပြောင်းလဲပါ။',
  },
  th: {
    title: 'xArticle — สตูดิโอบทความ Binance Square',
    description: 'เปลี่ยนไอเดียตลาดให้เป็นบทความ Binance Square ที่พร้อมเผยแพร่',
  },
  fil: {
    title: 'xArticle — studio ng artikulo sa Binance Square',
    description: 'Gawing handa nang i-publish na artikulo sa Binance Square ang isang ideya sa merkado.',
  },
};

export function metadataForLanguage(language: Language): LocalizedMetadata {
  return metadataByLanguage[language];
}
