---
name: baoyu-cover-image
description: Generates article cover images with 6 dimensions (type, palette, rendering, text, mood, font), 10 palettes, 8 renderings, and named style presets including six Binance styles. Supports exact Binance 1000x400 JPEG output plus cinematic, widescreen, and square covers. Use when user asks to "generate cover image", "create article cover", or "make cover".
---

# Cover Image Generator

Generate article cover images with six-dimensional customization and optional named style systems.

## Usage

```bash
# Auto-select dimensions based on content
/baoyu-cover-image path/to/article.md

# Quick mode: skip confirmation
/baoyu-cover-image article.md --quick

# Specify dimensions
/baoyu-cover-image article.md --type conceptual --palette warm --rendering flat-vector

# Style presets (shorthand for palette + rendering)
/baoyu-cover-image article.md --style blueprint

# Binance master with an explicit composition mode
/baoyu-cover-image article.md --style binance-master --style-mode briefing --aspect 5:2

# With reference images
/baoyu-cover-image article.md --ref style-ref.png

# Direct content input
/baoyu-cover-image --palette mono --aspect 1:1 --quick
[paste content]
```

## Options

| Option | Description |
|--------|-------------|
| `--type <name>` | hero, conceptual, typography, metaphor, scene, minimal |
| `--palette <name>` | warm, elegant, cool, dark, earth, vivid, pastel, mono, retro, binance |
| `--rendering <name>` | flat-vector, hand-drawn, painterly, digital, pixel, chalk, isometric, screen-print |
| `--style <name>` | Preset shorthand (see [Style Presets](references/style-presets.md)) |
| `--style-mode <name>` | `scene`, `mechanism`, `briefing`, or `primer` for `binance-master` |
| `--text <level>` | none, title-only, title-subtitle, text-rich |
| `--mood <level>` | subtle, balanced, bold |
| `--font <name>` | clean, handwritten, serif, display |
| `--aspect <ratio>` | 16:9, 2.35:1, 5:2, 4:3, 3:2, 1:1, 3:4 |
| `--lang <code>` | Title language (en, zh, ja, etc.) |
| `--no-title` | Alias for `--text none` |
| `--quick` | Skip confirmation, use auto-selection |
| `--ref <files...>` | Reference images for style/composition guidance |

## Six Dimensions

| Dimension | Values | Default |
|-----------|--------|---------|
| **Type** | hero, conceptual, typography, metaphor, scene, minimal | auto |
| **Palette** | warm, elegant, cool, dark, earth, vivid, pastel, mono, retro, binance | auto |
| **Rendering** | flat-vector, hand-drawn, painterly, digital, pixel, chalk, isometric, screen-print | auto |
| **Text** | none, title-only, title-subtitle, text-rich | none |
| **Mood** | subtle, balanced, bold | balanced |
| **Font** | clean, handwritten, serif, display | clean |

Auto-selection rules: [references/auto-selection.md](references/auto-selection.md)

## Galleries

**Types**: hero, conceptual, typography, metaphor, scene, minimal
→ Details: [references/types.md](references/types.md)

**Palettes**: warm, elegant, cool, dark, earth, vivid, pastel, mono, retro, binance
→ Details: [references/palettes/](references/palettes/)

**Renderings**: flat-vector, hand-drawn, painterly, digital, pixel, chalk, isometric, screen-print
→ Details: [references/renderings/](references/renderings/)

**Named Binance styles**: binance, binance-master, binance-briefing, binance-mondo-panoramic, binance-sketch-notes, binance-vector-illustration
→ Details: [references/styles/](references/styles/)

**Text Levels**: none (pure visual, default) | title-only | title-subtitle | text-rich (with tags)
→ Details: [references/dimensions/text.md](references/dimensions/text.md)

**Mood Levels**: subtle (low contrast) | balanced (default) | bold (high contrast)
→ Details: [references/dimensions/mood.md](references/dimensions/mood.md)

**Fonts**: clean (sans-serif) | handwritten | serif | display (bold decorative)
→ Details: [references/dimensions/font.md](references/dimensions/font.md)

## File Structure

Output directory per `default_output_dir` preference:
- `same-dir`: `{article-dir}/`
- `imgs-subdir`: `{article-dir}/imgs/`
- `independent` (default): `cover-image/{topic-slug}/`

```
<output-dir>/
├── source-{slug}.{ext}    # Source files
├── refs/                  # Reference images (if provided)
│   ├── ref-01-{slug}.{ext}
│   └── ref-01-{slug}.md   # Description file
├── prompts/cover.md       # Generation prompt
├── cover-source.{ext}     # Preserved generation source for Binance covers
├── cover.png              # Standard cover output
└── cover.jpg              # Exact 1000x400 Binance cover output
```

**Slug**: 2-4 words, kebab-case. Conflict: append `-YYYYMMDD-HHMMSS`

## Workflow

### Progress Checklist

```
Cover Image Progress:
- [ ] Step 0: Check preferences (EXTEND.md) ⛔ BLOCKING
- [ ] Step 1: Analyze content + save refs + determine output dir
- [ ] Step 2: Confirm options (6 dimensions) ⚠️ unless --quick
- [ ] Step 3: Create prompt
- [ ] Step 4: Generate image
- [ ] Step 5: Completion report
```

### Flow

```
Input → [Step 0: Preferences] ─┬─ Found → Continue
                               └─ Not found → First-Time Setup ⛔ BLOCKING → Save EXTEND.md → Continue
        ↓
Analyze + Save Refs → [Output Dir] → [Confirm: 6 Dimensions] → Prompt → Generate → Complete
                                              ↓
                                     (skip if --quick or all specified)
```

### Step 0: Load Preferences ⛔ BLOCKING

Check EXTEND.md existence (priority: project → user):
```bash
# macOS, Linux, WSL, Git Bash
test -f .baoyu-skills/baoyu-cover-image/EXTEND.md && echo "project"
test -f "$HOME/.baoyu-skills/baoyu-cover-image/EXTEND.md" && echo "user"
```

```powershell
# PowerShell (Windows)
if (Test-Path .baoyu-skills/baoyu-cover-image/EXTEND.md) { "project" }
if (Test-Path "$HOME/.baoyu-skills/baoyu-cover-image/EXTEND.md") { "user" }
```

| Result | Action |
|--------|--------|
| Found | Load, display summary → Continue |
| Not found | ⛔ Run first-time setup ([references/config/first-time-setup.md](references/config/first-time-setup.md)) → Save → Continue |

**CRITICAL**: If not found, complete setup BEFORE any other steps or questions.

### Step 1: Analyze Content

1. **Save reference images** (if provided) → [references/workflow/reference-images.md](references/workflow/reference-images.md)
2. **Save source content** (if pasted, save to `source.md`)
3. **Analyze content**: topic, tone, audience, keywords, visual metaphors, and data density
4. **Deep analyze references** ⚠️: Extract specific, concrete elements (see reference-images.md)
5. **Detect language**: Compare source, user input, EXTEND.md preference
6. **Determine output directory**: Per File Structure rules
7. **Resolve named style**: explicit `--style` → project preference → user preference → auto-selection. Existing saved palette/rendering choices remain valid when no named style is selected.
8. For `binance-master`, resolve exactly one mode: explicit `--style-mode` → saved mode → content-based Scene/Mechanism/Briefing/Primer selection.

### Step 2: Confirm Options ⚠️

Full confirmation flow: [references/workflow/confirm-options.md](references/workflow/confirm-options.md)

| Condition | Skipped | Still Asked |
|-----------|---------|-------------|
| `--quick` or `quick_mode: true` | 6 dimensions and named style/mode | Aspect ratio only when neither `--aspect` nor `default_aspect` exists |
| All 6 + `--aspect` specified | All | None |

### Step 3: Create Prompt

Save to `prompts/cover.md`. Template: [references/workflow/prompt-template.md](references/workflow/prompt-template.md)

If a named style is selected, load `references/styles/{style}.md` and apply it as the authoritative visual contract. A named style rule overrides conflicting generic type, palette, rendering, mood, composition, text, or reference guidance. Explicit request flags override project and user preferences. If an explicit request conflicts with a hard named-style rule, keep the requested dimension only where that style permits it and otherwise report the incompatibility.

**CRITICAL - References in Frontmatter**:
- Files saved to `refs/` → Add to frontmatter `references` list
- Style extracted verbally (no file) → Omit `references`, describe in body
- Before writing → Verify: `test -f refs/ref-NN-{slug}.{ext}`

**Reference elements in body** MUST be detailed, prefixed with "MUST"/"REQUIRED", with integration approach.

### Step 4: Generate Image

1. **Backup existing** `cover.png` or `cover.jpg` if regenerating
2. **Check image generation skills**; if multiple, ask preference
3. **Process references** from prompt frontmatter:
   - `direct` usage → pass via `--ref` (use ref-capable backend)
   - `style`/`palette` → extract traits, append to prompt
4. **Generate**: Call the image-generation skill with prompt file, output path, and aspect ratio.
5. **Binance output contract** (any of the six `binance*` styles):
   - Require a 5:2 final aspect. If the request explicitly combines a Binance named style with another aspect, report the incompatibility instead of silently changing either selection.
   - Compose for a 5:2 safe frame and generate a high-resolution `2.35:1` source as `cover-source.{ext}` because the image generator has no native 5:2 ratio.
   - Preserve the source file.
   - Resolve `${BUN_X}` as documented by `baoyu-image-gen`, then run `${BUN_X} ${SKILL_DIR}/scripts/prepare-binance-cover.ts --input <source> --output <output-dir>/cover.jpg`.
   - The postprocessor must crop/resize deterministically to exactly 1000x400, encode JPEG at quality 92, and verify JPEG signature, dimensions, and the 10 MiB limit.
6. On failure: auto-retry generation once. Do not bypass a failed Binance output verification.

### Step 5: Completion Report

```
Cover Generated!

Topic: [topic]
Style: [style or "custom"] [| Mode: mode when applicable]
Type: [type] | Palette: [palette] | Rendering: [rendering]
Text: [text] | Mood: [mood] | Font: [font] | Aspect: [ratio]
Title: [title or "visual only"]
Language: [lang] | Watermark: [enabled/disabled]
References: [N images or "extracted style" or "none"]
Location: [directory path]

Files:
✓ source-{slug}.{ext}
✓ prompts/cover.md
✓ cover.png (standard) or cover-source.{ext} + cover.jpg (Binance)
```

## Image Modification

| Action | Steps |
|--------|-------|
| **Regenerate** | Backup → Update prompt file FIRST → Regenerate |
| **Change dimension** | Backup → Confirm new value → Update prompt → Regenerate |

## Composition Principles

- **Whitespace**: 40-60% breathing room
- **Visual anchor**: Main element centered or offset left
- **Characters**: Simplified silhouettes; NO realistic humans
- **Title**: When text is enabled, use the exact title from user/source; never invent

## Extension Support

Custom configurations via EXTEND.md. See **Step 0** for paths.

Supports: Watermark | Preferred named style/mode | Preferred dimensions | Default aspect/output | Quick mode | Custom palettes | Language

Schema: [references/config/preferences-schema.md](references/config/preferences-schema.md)

## References

**Dimensions**: [text.md](references/dimensions/text.md) | [mood.md](references/dimensions/mood.md) | [font.md](references/dimensions/font.md)
**Palettes**: [references/palettes/](references/palettes/)
**Renderings**: [references/renderings/](references/renderings/)
**Types**: [references/types.md](references/types.md)
**Auto-Selection**: [references/auto-selection.md](references/auto-selection.md)
**Style Presets**: [references/style-presets.md](references/style-presets.md)
**Named Styles**: [references/styles/](references/styles/)
**Compatibility**: [references/compatibility.md](references/compatibility.md)
**Visual Elements**: [references/visual-elements.md](references/visual-elements.md)
**Workflow**: [confirm-options.md](references/workflow/confirm-options.md) | [prompt-template.md](references/workflow/prompt-template.md) | [reference-images.md](references/workflow/reference-images.md)
**Config**: [preferences-schema.md](references/config/preferences-schema.md) | [first-time-setup.md](references/config/first-time-setup.md) | [watermark-guide.md](references/config/watermark-guide.md)
