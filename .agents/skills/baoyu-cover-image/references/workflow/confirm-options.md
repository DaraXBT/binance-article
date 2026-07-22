# Step 2: Confirm Options

## Purpose

Validate the optional named style/mode, all 6 dimensions, and aspect ratio.

Resolution priority is: explicit request flags → project EXTEND.md → user EXTEND.md → content auto-selection. Explicit flags never rewrite saved preferences.

## Skip Conditions

| Condition | Skipped Questions | Still Asked |
|-----------|-------------------|-------------|
| `--quick` flag | Named style/mode, Type, Palette, Rendering, Text, Mood, Font | Aspect only when neither `--aspect` nor `default_aspect` is available |
| All 6 dimensions + `--aspect` specified | All | None |
| `quick_mode: true` in EXTEND.md | Named style/mode, Type, Palette, Rendering, Text, Mood, Font | Aspect only when neither `--aspect` nor `default_aspect` is available |
| Otherwise | None | Named style plus unresolved settings |

**Important**: In confirmation mode, saved values are shown as the recommended choice. In quick mode, saved values are selected directly. An explicit `--aspect` always overrides `default_aspect` for ordinary styles. The six Binance named styles have a fixed 5:2 final-cover contract; if they are combined with another explicit aspect, report the incompatibility and ask the user to change the style or use 5:2 rather than silently overriding either request.

## Quick Mode Output

When skipping 6 dimensions:

```
Quick Mode: Auto-selected dimensions
• Style: [style or custom] ([explicit flag / project preference / user preference / content reason])
• Mode: [mode] ([reason]; show only when applicable)
• Type: [type] ([reason])
• Palette: [palette] ([reason])
• Rendering: [rendering] ([reason])
• Text: [text] ([reason])
• Mood: [mood] ([reason])
• Font: [font] ([reason])

[Ask Aspect only if unresolved]
```

## Confirmation Flow

**Language**: Auto-determined (user's input language > saved preference > source language). No need to ask.

Present options in batches of at most three questions.

Skip any question where the dimension is already specified via an explicit flag. A named style supplies palette/rendering and its hard visual rules; do not ask those two questions unless the user explicitly chooses independent dimensions.

### Q0: Named Style (skip if `--style`)

```yaml
header: "Style"
question: "Which named cover style?"
multiSelect: false
options:
  - label: "[saved or auto-recommended style] (Recommended)"
    description: "[preference source or reason based on content signals]"
  - label: "binance-master"
    description: "Gold-on-black crypto system; mode selected from the article"
  - label: "No named style"
    description: "Choose palette and rendering independently"
```

When `binance-master` is selected, resolve exactly one mode:

| Signals | Mode |
|---------|------|
| Architecture, ecosystem, connections, general crypto | `scene` |
| Workflow, sequence, how-it-works, one focused concept | `mechanism` |
| Metrics, research, comparisons, real data | `briefing` |
| Beginner, onboarding, approachable explainer | `primer` |

An explicit `--style-mode` wins. Otherwise use a saved `preferred_style_mode`; when null, use the signal table. Show the resolved mode and reason rather than asking an extra question unless signals are genuinely ambiguous.

### Q1: Type (skip if `--type`)

```yaml
header: "Type"
question: "Which cover type?"
multiSelect: false
options:
  - label: "[auto-recommended type] (Recommended)"
    description: "[reason based on content signals]"
  - label: "hero"
    description: "Large visual impact, title overlay - product launch, announcements"
  - label: "conceptual"
    description: "Concept visualization - technical, architecture"
```

### Q2: Palette (skip if `--palette` or a named style is selected)

```yaml
header: "Palette"
question: "Which color palette?"
multiSelect: false
options:
  - label: "[auto-recommended palette] (Recommended)"
    description: "[reason based on content signals]"
  - label: "warm"
    description: "Friendly - orange, golden yellow, terracotta"
  - label: "cool"
    description: "Technical - engineering blue, navy, cyan"
```

### Q3: Rendering (skip if `--rendering` or a named style is selected)

Show compatible renderings (✓✓ first from compatibility matrix):

```yaml
header: "Rendering"
question: "Which rendering style?"
multiSelect: false
options:
  - label: "[best compatible rendering] (Recommended)"
    description: "[reason based on palette + type + content]"
  - label: "flat-vector"
    description: "Clean outlines, flat fills, geometric icons"
  - label: "hand-drawn"
    description: "Sketchy, organic, imperfect strokes"
```

### Q4: Font (skip if `--font`)

```yaml
header: "Font"
question: "Which font style?"
multiSelect: false
options:
  - label: "[auto-recommended font] (Recommended)"
    description: "[reason based on content signals]"
  - label: "clean"
    description: "Modern geometric sans-serif - tech, professional"
  - label: "handwritten"
    description: "Warm hand-lettered - personal, friendly"
```

### Q5: Other Settings (skip if all remaining dimensions already specified)

Combine remaining settings into one question. Include: Output Dir (if no preference + file path input), Text, Mood, Aspect. Show resolved saved/auto values as recommended. User can accept all or type adjustments via "Other".

For any Binance named style, recommend `none / balanced / 5:2` unless explicitly overridden. The project's Binance cover contract uses no embedded text and produces an exact 1000x400 JPEG after generation.

**When output dir needs asking** (no `default_output_dir` preference + file path input):

```yaml
header: "Settings"
question: "Output / Text / Mood / Aspect?"
multiSelect: false
options:
  - label: "imgs/ / [auto-text] / [auto-mood] / [preset-aspect] (Recommended)"
    description: "{article-dir}/imgs/, [text reason], [mood reason], [aspect source]"
  - label: "same-dir / [auto-text] / [auto-mood] / [preset-aspect]"
    description: "{article-dir}/, same directory as article"
  - label: "independent / [auto-text] / [auto-mood] / [preset-aspect]"
    description: "cover-image/{topic-slug}/, separate from article"
```

**When output dir already set** (preference exists or pasted content):

```yaml
header: "Settings"
question: "Text / Mood / Aspect?"
multiSelect: false
options:
  - label: "[auto-text] / [auto-mood] / [preset-aspect] (Recommended)"
    description: "Auto-selected: [text reason], [mood reason], [aspect source]"
  - label: "[auto-text] / bold / [preset-aspect]"
    description: "High contrast, vivid — matches [content signal]"
  - label: "[auto-text] / subtle / [preset-aspect]"
    description: "Low contrast, muted — calm, professional"
```

*Note*: "Other" (auto-added) allows typing custom combo. Parse `/`-separated values matching the question format.

## After Response

Proceed to Step 3 with confirmed dimensions.
