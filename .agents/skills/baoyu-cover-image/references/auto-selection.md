# Auto-Selection Rules

When a dimension is omitted, select based on content signals. Selection spans six dimensions; the built-in visual catalog contains 10 palettes and 8 renderings.

## Auto Type Selection

| Signals | Type |
|---------|------|
| Product, launch, announcement, release, reveal | `hero` |
| Architecture, framework, system, API, technical, model | `conceptual` |
| Quote, opinion, insight, thought, headline, statement | `typography` |
| Philosophy, growth, abstract, meaning, reflection | `metaphor` |
| Story, journey, travel, lifestyle, experience, narrative | `scene` |
| Zen, focus, essential, core, simple, pure | `minimal` |

## Auto Palette Selection

| Signals | Palette |
|---------|---------|
| Personal story, emotion, lifestyle, human | `warm` |
| Business, professional, thought leadership, luxury | `elegant` |
| Architecture, system, API, technical, code | `cool` |
| Entertainment, premium, cinematic, dark mode | `dark` |
| Nature, wellness, eco, organic, travel | `earth` |
| Product launch, gaming, promotion, event | `vivid` |
| Fantasy, children, gentle, creative, whimsical | `pastel` |
| Zen, focus, essential, pure, simple | `mono` |
| History, vintage, retro, classic, exploration | `retro` |
| Crypto, blockchain, exchange, trading, DeFi, Web3 | `binance` |

## Auto Rendering Selection

| Signals | Rendering |
|---------|-----------|
| Clean, modern, tech, WeChat, icon-based, infographic | `flat-vector` |
| Sketch, note, personal, casual, doodle, warm | `hand-drawn` |
| Art, watercolor, soft, dreamy, creative, fantasy | `painterly` |
| Data, dashboard, SaaS, corporate, polished | `digital` |
| Gaming, retro, 8-bit, nostalgic | `pixel` |
| Education, tutorial, classroom, teaching | `chalk` |
| Protocol architecture, ecosystem, exchange flow, token mechanics | `isometric` |
| Evolution, transformation, before/after, old world to new world, panoramic poster | `screen-print` |

## Auto Style Preset Selection

Use a style preset when the content signal is specific enough to select both palette and rendering together.

| Signals | Style Preset |
|---------|--------------|
| General crypto ecosystem, DeFi flow, exchange mechanics | `binance` |
| Mixed technical and beginner registers across one visual system | `binance-master` |
| Research, metrics, comparisons, tokenomics, whitepaper analysis | `binance-briefing` |
| Evolution, adoption arc, before/after, financial transformation | `binance-mondo-panoramic` |
| Beginner tips, glossary, onboarding, friendly hand-lettered recap | `binance-sketch-notes` |
| Friendly product explainer, toy-model scene, feature announcement | `binance-vector-illustration` |

### Binance Master Mode Selection

When `binance-master` is selected without an explicit `style_mode`, choose exactly one mode from content:

| Signals | `style_mode` | Rendering |
|---------|--------------|-----------|
| Ecosystem, architecture, framework, general crypto overview | `scene` | `isometric` |
| Workflow, process, how it works, sequenced mechanism | `mechanism` | `isometric` |
| Metrics, research, comparison, data-heavy analysis | `briefing` | `isometric` |
| Beginner, onboarding, basics, friendly how-to | `primer` | `flat-vector` |

## Auto Text Selection

| Signals | Text Level |
|---------|------------|
| Visual-only, photography, abstract, art | `none` |
| Explicit request for an embedded headline | `title-only` |
| Explicit request for title plus supporting context | `title-subtitle` |
| Explicit request for promotional copy, tags, or infographic labels | `text-rich` |

Default: `none`. Use embedded text only when explicitly requested or clearly required by a text-led cover type.

## Auto Mood Selection

| Signals | Mood Level |
|---------|------------|
| Professional, corporate, thought leadership, academic, luxury | `subtle` |
| General, educational, standard, blog, documentation | `balanced` |
| Launch, announcement, promotion, event, gaming, entertainment | `bold` |

Default: `balanced`

## Auto Font Selection

| Signals | Font |
|---------|------|
| Personal, lifestyle, human, warm, friendly, story | `handwritten` |
| Technical, professional, clean, modern, minimal, data | `clean` |
| Editorial, academic, luxury, classic, literary | `serif` |
| Announcement, entertainment, promotion, bold, event, gaming | `display` |

Default: `clean`
