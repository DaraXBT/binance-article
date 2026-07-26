// Illustration styles for Binance article automation. Keep this tuple as the
// canonical wire-level contract; schemas, UI controls, and worker payloads
// derive their accepted IDs from it.
export const ILLUSTRATION_STYLE_IDS = [
  'pixel-art',
  'fantasy-animation',
  'lab-notes',
  'binance',
  'binance-master',
  'binance-briefing',
  'binance-mondo-panoramic',
  'binance-sketch-notes',
  'binance-vector-illustration',
] as const;

export type IllustrationStyleId = typeof ILLUSTRATION_STYLE_IDS[number];

export const DEFAULT_ILLUSTRATION_STYLE: IllustrationStyleId = 'binance-master';

type IllustrationStyleDefinition = {
  id: IllustrationStyleId;
  name: string;
  description: string;
  icon: string;
  colors: readonly string[];
  bestFor: string;
};

export const ILLUSTRATION_STYLES = [
  {
    id: 'pixel-art',
    name: 'Pixel Art',
    description: 'Retro 8-bit crypto gaming aesthetic with chunky pixels and isometric scenes',
    icon: '🎮',
    colors: ['#0C0E12', '#F0B90B', '#FCD535', '#02C076', '#F6465D'],
    bestFor: 'GameFi, hackathon posts, developer tutorials, community engagement',
  },
  {
    id: 'fantasy-animation',
    name: 'Fantasy Animation',
    description: 'Enchanted storybook narrative with magical glow and painterly warmth',
    icon: '✨',
    colors: ['#0C0E12', '#F0B90B', '#FCD535', '#E89A3D', '#F3E7D3'],
    bestFor: 'Web3 explainers, DeFi onboarding, product storytelling, editorial visuals',
  },
  {
    id: 'lab-notes',
    name: 'Lab Notes',
    description: 'Technical annotated research diagrams with sparse note clarity',
    icon: '🔬',
    colors: ['#0C0E12', '#F0B90B', '#FCD535', '#B7BDC6', '#707A8A'],
    bestFor: 'Protocol explainers, DeFi breakdowns, workflow visualizations, research notes',
  },
  {
    id: 'binance',
    name: 'Binance Isometric Flow',
    description: 'Dark crypto-native isometric scenes with playful platforms and structured gold accents',
    icon: '◆',
    colors: ['#0C0E12', '#1E2329', '#2B3139', '#F0B90B', '#FCD535'],
    bestFor: 'Crypto ecosystems, blockchain flows, and exchange mechanics',
  },
  {
    id: 'binance-master',
    name: 'Binance All-In-One',
    description: 'One gold-on-black system spanning Scene, Mechanism, Briefing, and Primer registers',
    icon: '✦',
    colors: ['#0C0E12', '#1E2329', '#3D3D3D', '#F0B90B', '#EAECEF'],
    bestFor: 'Mixed technical content and beginner onboarding',
  },
  {
    id: 'binance-briefing',
    name: 'Binance Technical Briefing',
    description: 'Research-grade dark infographic with isometric diagrams and annotated callouts',
    icon: '▦',
    colors: ['#0C0E12', '#1E2329', '#2F7373', '#F0B90B', '#FCD535'],
    bestFor: 'Metrics, comparisons, whitepapers, and protocol research',
  },
  {
    id: 'binance-mondo-panoramic',
    name: 'Binance Mondo Panoramic',
    description: 'Dark screen-print storytelling with a left-to-right evolution across three zones',
    icon: '▰',
    colors: ['#0C0E12', '#3D3D3D', '#707A8A', '#F0B90B', '#FCD535'],
    bestFor: 'Transformation stories, adoption arcs, and before-after narratives',
  },
  {
    id: 'binance-sketch-notes',
    name: 'Binance Sketch Notes',
    description: 'Warm hand-drawn notes with open structure, friendly marks, and Binance accents',
    icon: '✎',
    colors: ['#0C0E12', '#1E2329', '#2B3139', '#F0B90B', '#EAECEF'],
    bestFor: 'Beginner explainers, onboarding, and wallet/security tips',
  },
  {
    id: 'binance-vector-illustration',
    name: 'Binance Flat Vector',
    description: 'Dark coloring-book scenes with bold gold/light-gray outlines and toy-model props',
    icon: '◇',
    colors: ['#0C0E12', '#1E2329', '#2B3139', '#F0B90B', '#EAECEF'],
    bestFor: 'Friendly DeFi education, feature announcements, and product explainers',
  },
] as const satisfies readonly IllustrationStyleDefinition[];

// Validation rules
export const VALIDATION = {
  TITLE_MAX_LENGTH: 200,
  DESCRIPTION_MAX_LENGTH: 1000,
  CONTENT_MAX_LENGTH: 50000,
  SLIDE_TITLE_MAX_LENGTH: 150,
  SLIDE_BULLETS_MAX: 7,
  BULLET_MAX_LENGTH: 200,
  NOTES_MAX_LENGTH: 500,
};
