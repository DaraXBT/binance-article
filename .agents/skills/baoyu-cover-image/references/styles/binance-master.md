# binance-master

Binance All-In-One — one gold-on-black cover system with four mutually exclusive registers.

**Preset mapping:** palette [`binance`](../palettes/binance.md) + rendering [`isometric`](../renderings/isometric.md); **Primer** alone overrides rendering with [`flat-vector`](../renderings/flat-vector.md).

## Register Selection

Choose exactly one register per cover; never blend Primer with an isometric register. In prompt frontmatter, record the selection as exactly one lowercase `style_mode`: `scene`, `mechanism`, `briefing`, or `primer`.

| Register | Use For | Cover Treatment |
|----------|---------|-----------------|
| **Scene** | Ecosystems, architecture, frameworks | Sparse 30° isometric cluster with 2–4 platforms and minimal annotation |
| **Mechanism** | One workflow or how-it-works concept | One isometric hero mechanism with 2–4 anchored note tags |
| **Briefing** | Metrics, comparisons, research | Isometric hero with 3–6 callouts, real charts, and one gold key-insight panel |
| **Primer** | Beginners, onboarding, friendly how-tos | Flat front-on toy-model scene with uniform gold/light-gray outlines and at most one tiny isometric accent |

## Shared Cover Rules

- Keep Canvas Black `#0C0E12`, gold-led hierarchy, flat fills, an 8px rhythm, and 40–60% breathing room.
- Use article-specific terms and icons. Green `#02C076` and red `#F6465D` are data states only.
- Scene, Mechanism, and Briefing use grounded zero-outline people; Primer uses outlined geometric people on a flat ground plane.
- With `text: none`, omit every title, label, numeral, note, and wordmark. Preserve Mechanism/Briefing structure with icon chips, mini-diagrams, chart shapes, markers without digits, and leader lines. When text is explicitly enabled, keep it concise and typeset in the article language; never outline text glyphs.
- Do not draw a Binance or BNB logo; the palette and crypto vocabulary carry the identity.

## Avoid

Mixed registers, decorative fake data, engineering-blue dominance, hand-lettering, gradients, photorealism, or dense annotation when the content does not require it.

## Best For

Mixed crypto/Web3 editorial series that need technical diagrams and approachable beginner covers under one consistent visual system.
