---
name: preferences-schema
description: EXTEND.md YAML schema for baoyu-cover-image user preferences
---

# Preferences Schema

## Full Schema

```yaml
---
version: 4

watermark:
  enabled: false
  content: ""
  position: bottom-right  # bottom-right|bottom-left|bottom-center|top-right

preferred_type: null      # hero|conceptual|typography|metaphor|scene|minimal or null for auto-select

preferred_style: null     # named preset, including the six binance* styles, or null

preferred_style_mode: null # scene|mechanism|briefing|primer for binance-master, or null for content selection

preferred_palette: null   # warm|elegant|cool|dark|earth|vivid|pastel|mono|retro|binance or null for auto-select

preferred_rendering: null # flat-vector|hand-drawn|painterly|digital|pixel|chalk|isometric|screen-print or null

preferred_text: none      # none|title-only|title-subtitle|text-rich

preferred_mood: balanced    # subtle|balanced|bold

default_aspect: "2.35:1"  # 2.35:1|5:2|16:9|1:1

default_output_dir: independent # independent|same-dir|imgs-subdir

quick_mode: false         # Skip confirmation when true

language: null            # zh|en|ja|ko|auto (null = auto-detect)

custom_palettes:
  - name: my-palette
    description: "Palette description"
    colors:
      primary: ["#1E3A5F", "#4A90D9"]
      background: "#F5F7FA"
      accents: ["#00B4D8"]
    decorative_hints: "Clean lines, geometric shapes"
    best_for: "Business, tech content"
---
```

## Field Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `version` | int | 4 | Schema version |
| `watermark.enabled` | bool | false | Enable watermark |
| `watermark.content` | string | "" | Watermark text (@username or custom) |
| `watermark.position` | enum | bottom-right | Position on image |
| `preferred_type` | string | null | Type name or null for auto |
| `preferred_style` | string | null | Named style preset or null for dimension-based selection |
| `preferred_style_mode` | string | null | Optional Binance Master mode; null selects from content |
| `preferred_palette` | string | null | Palette name or null for auto |
| `preferred_rendering` | string | null | Rendering name or null for auto |
| `preferred_text` | string | none | Text density level |
| `preferred_mood` | string | balanced | Mood intensity level |
| `default_aspect` | string | "2.35:1" | Default aspect ratio |
| `default_output_dir` | string | independent | Cover output placement |
| `quick_mode` | bool | false | Skip confirmation step |
| `language` | string | null | Output language (null = auto-detect) |
| `custom_palettes` | array | [] | User-defined palettes |

## Type Options

| Value | Description |
|-------|-------------|
| `hero` | Large visual impact, title overlay |
| `conceptual` | Concept visualization, abstract core ideas |
| `typography` | Text-focused layout, prominent title |
| `metaphor` | Visual metaphor, concrete expressing abstract |
| `scene` | Atmospheric scene, narrative feel |
| `minimal` | Minimalist composition, generous whitespace |

## Palette Options

| Value | Description |
|-------|-------------|
| `warm` | Friendly, approachable — orange, golden yellow, terracotta |
| `elegant` | Sophisticated, refined — soft coral, muted teal, dusty rose |
| `cool` | Technical, professional — engineering blue, navy, cyan |
| `dark` | Cinematic, premium — electric purple, cyan, magenta |
| `earth` | Natural, organic — forest green, sage, earth brown |
| `vivid` | Energetic, bold — bright red, neon green, electric blue |
| `pastel` | Gentle, whimsical — soft pink, mint, lavender |
| `mono` | Clean, focused — black, near-black, white |
| `retro` | Nostalgic, vintage — muted orange, dusty pink, maroon |
| `binance` | Crypto-native — Canvas Black, Binance Gold, grayscale structure |

## Binance Named Style Options

| Value | Derived Palette | Derived Rendering | Notes |
|-------|-----------------|-------------------|-------|
| `binance` | binance | isometric | Light isometric flow scenes |
| `binance-master` | binance | isometric or flat-vector | Selects Scene, Mechanism, Briefing, or Primer from content |
| `binance-briefing` | binance | isometric | Dense research-grade annotated figures |
| `binance-mondo-panoramic` | binance | screen-print | Left-to-right transformation narrative |
| `binance-sketch-notes` | binance | hand-drawn | Gold/chalk hand-lettered card grid |
| `binance-vector-illustration` | binance | flat-vector | Flat coloring-book scene with bold outlines |

## Rendering Options

| Value | Description |
|-------|-------------|
| `flat-vector` | Clean outlines, uniform fills, geometric icons |
| `hand-drawn` | Sketchy, organic, imperfect strokes, paper texture |
| `painterly` | Soft brush strokes, color bleeds, watercolor feel |
| `digital` | Polished, precise edges, subtle gradients, UI components |
| `pixel` | Pixel grid, dithering, chunky 8-bit shapes |
| `chalk` | Chalk strokes, dust effects, blackboard texture |
| `isometric` | Flat 30-degree isometric platforms, diagrams, and iso-grid flows |
| `screen-print` | Flat poster shapes with halftone dots and restrained paper grain |

## Text Options

| Value | Description |
|-------|-------------|
| `none` | Pure visual, no text elements |
| `title-only` | Single headline |
| `title-subtitle` | Title + subtitle |
| `text-rich` | Title + subtitle + keyword tags (2-4) |

## Mood Options

| Value | Description |
|-------|-------------|
| `subtle` | Low contrast, muted colors, calm aesthetic |
| `balanced` | Medium contrast, normal saturation, versatile |
| `bold` | High contrast, vivid colors, dynamic energy |

## Position Options

| Value | Description |
|-------|-------------|
| `bottom-right` | Lower right corner (default, most common) |
| `bottom-left` | Lower left corner |
| `bottom-center` | Bottom center |
| `top-right` | Upper right corner |

## Aspect Ratio Options

| Value | Description | Best For |
|-------|-------------|----------|
| `2.35:1` | Cinematic widescreen | Article headers, blog covers |
| `16:9` | Standard widescreen | Presentations, video thumbnails |
| `1:1` | Square | Social media, profile images |
| `5:2` | Exact Binance article cover | Generated from a 2.35:1 safe composition, then cropped to 1000x400 JPEG |

## Custom Palette Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique palette identifier (kebab-case) |
| `description` | Yes | What the palette conveys |
| `colors.primary` | No | Main colors (array of hex) |
| `colors.background` | No | Background color (hex) |
| `colors.accents` | No | Accent colors (array of hex) |
| `decorative_hints` | No | Decorative elements and patterns |
| `best_for` | No | Recommended content types |

## Example: Minimal Preferences

```yaml
---
version: 4
watermark:
  enabled: true
  content: "@myhandle"
preferred_type: null
preferred_style: null
preferred_style_mode: null
preferred_palette: elegant
preferred_rendering: hand-drawn
preferred_text: none
preferred_mood: balanced
quick_mode: false
---
```

## Example: Full Preferences

```yaml
---
version: 4
watermark:
  enabled: true
  content: "myblog.com"
  position: bottom-right

preferred_type: conceptual

preferred_style: binance-master

preferred_style_mode: null

preferred_palette: binance

preferred_rendering: isometric

preferred_text: none

preferred_mood: subtle

default_aspect: "5:2"

default_output_dir: independent

quick_mode: true

language: en

custom_palettes:
  - name: corporate-tech
    description: "Professional B2B tech palette"
    colors:
      primary: ["#1E3A5F", "#4A90D9"]
      background: "#F5F7FA"
      accents: ["#00B4D8", "#48CAE4"]
    decorative_hints: "Clean lines, subtle gradients, circuit patterns"
    best_for: "SaaS, enterprise, technical"
---
```

## Migration from v3

When loading v3, retain every explicit existing value and add only the new fields:

| v3 Field | v4 Field | Migration |
|----------|----------|-----------|
| `version: 3` | `version: 4` | Update |
| (missing) | `preferred_style` | `null` |
| (missing) | `preferred_style_mode` | `null` |
| Existing palette/rendering/text/aspect | Same field | Preserve unchanged |

## Migration from v2

When loading v2 schema, auto-upgrade:

| v2 Field | v4 Field | Migration |
|----------|----------|-----------|
| `version: 2` | `version: 4` | Update |
| `preferred_style` | `preferred_style` plus derived `preferred_palette` + `preferred_rendering` | Preserve the preset name and use the mapping table |
| `custom_styles` | `custom_palettes` | Rename, restructure fields |

**Style → Palette + Rendering mapping**:

| v2 `preferred_style` | v4 `preferred_palette` | v4 `preferred_rendering` |
|----------------------|----------------------|-------------------------|
| `elegant` | `elegant` | `hand-drawn` |
| `blueprint` | `cool` | `digital` |
| `chalkboard` | `dark` | `chalk` |
| `dark-atmospheric` | `dark` | `digital` |
| `editorial-infographic` | `cool` | `digital` |
| `fantasy-animation` | `pastel` | `painterly` |
| `flat-doodle` | `pastel` | `flat-vector` |
| `intuition-machine` | `retro` | `digital` |
| `minimal` | `mono` | `flat-vector` |
| `nature` | `earth` | `hand-drawn` |
| `notion` | `mono` | `digital` |
| `pixel-art` | `vivid` | `pixel` |
| `playful` | `pastel` | `hand-drawn` |
| `retro` | `retro` | `digital` |
| `sketch-notes` | `warm` | `hand-drawn` |
| `vector-illustration` | `retro` | `flat-vector` |
| `vintage` | `retro` | `hand-drawn` |
| `warm` | `warm` | `hand-drawn` |
| `watercolor` | `earth` | `painterly` |
| `binance` | `binance` | `isometric` |
| `binance-master` | `binance` | `isometric` |
| `binance-briefing` | `binance` | `isometric` |
| `binance-mondo-panoramic` | `binance` | `screen-print` |
| `binance-sketch-notes` | `binance` | `hand-drawn` |
| `binance-vector-illustration` | `binance` | `flat-vector` |
| null (auto) | null | null |

**Custom style migration**:

| v2 Field | v4 Field |
|----------|----------|
| `custom_styles[].name` | `custom_palettes[].name` |
| `custom_styles[].description` | `custom_palettes[].description` |
| `custom_styles[].color_palette` | `custom_palettes[].colors` |
| `custom_styles[].visual_elements` | `custom_palettes[].decorative_hints` |
| `custom_styles[].typography` | (removed — determined by rendering) |
| `custom_styles[].best_for` | `custom_palettes[].best_for` |

## Migration from v1

When loading v1 schema, auto-upgrade to v4:

| v1 Field | v4 Field | Default Value |
|----------|----------|---------------|
| (missing) | `version` | 4 |
| (missing) | `preferred_style` | null |
| (missing) | `preferred_style_mode` | null |
| (missing) | `preferred_palette` | null |
| (missing) | `preferred_rendering` | null |
| (missing) | `preferred_text` | none |
| (missing) | `preferred_mood` | balanced |
| (missing) | `quick_mode` | false |

v1 `--no-title` flag maps to `preferred_text: none`.
