import {
  DEFAULT_ILLUSTRATION_STYLE,
  ILLUSTRATION_STYLE_IDS,
  type IllustrationStyleId,
} from '@/lib/config';

export type IllustrationTextPolicy = 'none' | 'short-labels' | 'hand-lettered';
export type IllustrationLogoPolicy = 'forbidden' | 'bnb-required' | 'bnb-optional';

export interface IllustrationStylePromptDefinition {
  id: IllustrationStyleId;
  deckGuidance: string;
  imageGuidance: string;
  textPolicy: IllustrationTextPolicy;
  logoPolicy: IllustrationLogoPolicy;
}

const UNIVERSAL_BINANCE_GUIDANCE = `
Universal Binance DNA: use Canvas Black #0C0E12, flat fills, no gradients or glossy 3D rendering,
gold #F0B90B as the hero accent and bright gold #FCD535 for active marks, Card Surface #1E2329,
Border Gray #2B3139, primary text #EAECEF, and muted text #707A8A. Keep an intentional dark
negative space, an 8px rhythm, topic-specific crypto iconography, and only data-state green
#02C076 or red #F6465D. Replace generic nouns with the slide's actual subject.
`.trim();

const STYLE_PROMPTS: Record<IllustrationStyleId, IllustrationStylePromptDefinition> = {
  'pixel-art': {
    id: 'pixel-art',
    deckGuidance: 'Retro 8-bit crypto gaming illustration with chunky pixels, isometric scenes, dithering, staircase edges, and Binance gold on a dark canvas. Keep the image text-free.',
    imageGuidance: 'Binance Pixel Art: chunky 8-bit sprites, pixel-grid alignment, dithering, staircase edges, floating coin sprites, and a clear GameFi/trading visual hierarchy on Canvas Black.',
    textPolicy: 'none',
    logoPolicy: 'forbidden',
  },
  'fantasy-animation': {
    id: 'fantasy-animation',
    deckGuidance: 'Dark enchanted storybook scenes with painterly warmth, expressive characters, lantern highlights, soft ember accents, and gold-led isometric structure. Keep generated imagery free of captions and logos.',
    imageGuidance: 'Binance Fantasy Animation: a dark storybook crypto scene with painterly warmth, expressive characters, lantern-light highlights, soft ember accents, and restrained gold structure. No photorealism, captions, or logos.',
    textPolicy: 'none',
    logoPolicy: 'forbidden',
  },
  'lab-notes': {
    id: 'lab-notes',
    deckGuidance: 'Sparse technical lab-note diagrams on a dark isometric grid: one hero mechanism, compact figure markers, leader lines, and research-note clarity. Keep the generated image text-free because slide copy is rendered separately.',
    imageGuidance: 'Binance Lab Notes: dark isometric technical diagram, one hero mechanism, sparse figure markers and leader-line structure, gold hierarchy, restrained neutral grays, and no rendered captions or logos.',
    textPolicy: 'none',
    logoPolicy: 'forbidden',
  },
  binance: {
    id: 'binance',
    deckGuidance: `${UNIVERSAL_BINANCE_GUIDANCE}\n\nBinance Isometric Flow: default 30-degree isometric register with 2–4 floating platforms, one topic icon per platform, solid gold connectors, purposeful flat-filled people on platforms, and one BNB mark per scene. Use short article-language labels only when they clarify the diagram.`,
    imageGuidance: `${UNIVERSAL_BINANCE_GUIDANCE}\n\nBinance Isometric Flow: 30-degree isometric platforms and slabs with ground shadows only; 2–4 topic-specific platforms, no more than three gold-topped platforms, solid #FCD535 iso-axis connectors, purposeful diverse micro-people standing on platforms, one outlined crypto icon per platform, and exactly one BNB mark.`,
    textPolicy: 'short-labels',
    logoPolicy: 'bnb-required',
  },
  'binance-master': {
    id: 'binance-master',
    deckGuidance: `${UNIVERSAL_BINANCE_GUIDANCE}\n\nBinance All-In-One: choose exactly one register per slide and prefix its imagePrompt with a non-rendered marker: [MASTER_MODE: SCENE], [MASTER_MODE: MECHANISM], [MASTER_MODE: BRIEFING], or [MASTER_MODE: PRIMER]. Scene is sparse ecosystem structure; Mechanism is one focused workflow with 2–4 notes; Briefing is genuinely data-dense with callouts and a key insight; Primer is flat, front-on, warm, and outlined for beginners. Never blend registers and never render the marker as visible text. No Binance/BNB logo.`,
    imageGuidance: `${UNIVERSAL_BINANCE_GUIDANCE}\n\nBinance All-In-One: obey exactly one [MASTER_MODE] marker if present. Scene, Mechanism, and Briefing use the same 30-degree isometric instrument at increasing annotation density; Primer is flat front-on with bold gold/light-gray outlines, toy-model props, outlined people, and at most one small iso accent. Keep mode boundaries clear, use real slide terms/data, and never draw a brand logo.`,
    textPolicy: 'short-labels',
    logoPolicy: 'forbidden',
  },
  'binance-briefing': {
    id: 'binance-briefing',
    deckGuidance: `${UNIVERSAL_BINANCE_GUIDANCE}\n\nBinance Technical Briefing: research-grade 30-degree isometric hero diagram surrounded by 3–6 compact callout boxes, dotted leader lines, real charts when data is present, and at least one gold key-insight panel. Labels and callouts use the article language, not invented bilingual copy. No brand logo.`,
    imageGuidance: `${UNIVERSAL_BINANCE_GUIDANCE}\n\nBinance Technical Briefing: dense but ordered dark research figure with a central isometric diagram, 3–6 annotated callout boxes, dotted #707A8A leader lines terminating at exact anchors, real bar/donut/line/candlestick data, and a 2px bright-gold key-insight panel. Teal #2F7373, maroon #722F37, and warm brown #8B7355 are subordinate annotation colors only. Use concise article-language labels and no brand logo.`,
    textPolicy: 'short-labels',
    logoPolicy: 'forbidden',
  },
  'binance-mondo-panoramic': {
    id: 'binance-mondo-panoramic',
    deckGuidance: `${UNIVERSAL_BINANCE_GUIDANCE}\n\nBinance Mondo Panoramic: tell one strict left-to-right evolution across old-world, transition, and futuristic zones. Use symbolic flat screen-print objects, grounded silhouette figures, halftone/paper-grain restraint, and increasing gold intensity. The visual narrative should work without labels.`,
    imageGuidance: `${UNIVERSAL_BINANCE_GUIDANCE}\n\nBinance Mondo Panoramic: wide 16:9 screen-print poster composition flowing left to right through three connected zones—aged traditional finance, a cracking transformation middle, and bright futuristic crypto infrastructure. Use flat geometric color blocks, restrained halftone dots and paper grain, grounded zero-detail silhouettes, symbolic objects, and no captions or labels. A single BNB mark is optional in the right zone.`,
    textPolicy: 'none',
    logoPolicy: 'bnb-optional',
  },
  'binance-sketch-notes': {
    id: 'binance-sketch-notes',
    deckGuidance: `${UNIVERSAL_BINANCE_GUIDANCE}\n\nBinance Sketch Notes: use a flat three-band dark sketchbook page with a hand-lettered gold title, 2–6 wobbly rounded info cards, hand-drawn arrows and sparse doodles, and one short hand-lettered takeaway. Text follows the article language; the wobble is intentional and no isometric hero mechanism should dominate.`,
    imageGuidance: `${UNIVERSAL_BINANCE_GUIDANCE}\n\nBinance Sketch Notes: flat front-on black sketchbook page with a subtle square dot grid, deliberate hand-drawn wobble, gold gel-pen and off-white chalk strokes, 2–6 outline-led rounded cards, one icon plus one short keyword per card, sparse stars/sparkles, and one hand-lettered takeaway line. Use article-language lettering, no paragraphs, no gradients, no people scenes, and no logo.`,
    textPolicy: 'hand-lettered',
    logoPolicy: 'forbidden',
  },
  'binance-vector-illustration': {
    id: 'binance-vector-illustration',
    deckGuidance: `${UNIVERSAL_BINANCE_GUIDANCE}\n\nBinance Flat Vector: approachable flat front-on coloring-book scene with toy-model geometric props, uniform 3px gold/light-gray outlines, overlap-based depth, simplified topic icons, and at most one small iso accent. Use concise article-language labels without outlining text glyphs.`,
    imageGuidance: `${UNIVERSAL_BINANCE_GUIDANCE}\n\nBinance Flat Vector: front-on 2D toy-model composition on a flat square dot grid, depth only through overlap, bold uniform 3px closed rounded outlines (#F0B90B/#FCD535 for heroes and #EAECEF for support), simplified topic-relevant icons, outlined purposeful people on the ground plane, and at most one small iso accent. Use short article-language labels, flat fills only, and no brand logo.`,
    textPolicy: 'short-labels',
    logoPolicy: 'forbidden',
  },
};

export const ILLUSTRATION_STYLE_PROMPTS = STYLE_PROMPTS;

export function getIllustrationStylePrompt(
  illustrationStyle: string,
): IllustrationStylePromptDefinition {
  return STYLE_PROMPTS[illustrationStyle as IllustrationStyleId]
    ?? STYLE_PROMPTS[DEFAULT_ILLUSTRATION_STYLE];
}

export function getIllustrationStyleDeckGuidance(illustrationStyle: string): string {
  return getIllustrationStylePrompt(illustrationStyle).deckGuidance;
}

export function getIllustrationStyleImageGuidance(illustrationStyle: string): string {
  return getIllustrationStylePrompt(illustrationStyle).imageGuidance;
}

export function getIllustrationTextPolicy(illustrationStyle: string): IllustrationTextPolicy {
  return getIllustrationStylePrompt(illustrationStyle).textPolicy;
}

export function getIllustrationLogoPolicy(illustrationStyle: string): IllustrationLogoPolicy {
  return getIllustrationStylePrompt(illustrationStyle).logoPolicy;
}

// Keep this exported for catalog-consistency tests without coupling callers to
// the implementation object’s key order.
export { ILLUSTRATION_STYLE_IDS };
