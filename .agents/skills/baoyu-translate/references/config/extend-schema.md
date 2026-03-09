# EXTEND.md Schema for baoyu-translate

## Format

EXTEND.md uses YAML format:

```yaml
# Default target language (ISO code or common name)
target_language: zh-CN

# Default translation mode
default_mode: normal  # quick | normal | refined

# Target audience (affects annotation depth and register)
audience: general  # general | technical | academic | business | or custom string

# Translation style preference
style: storytelling  # storytelling | formal | technical | literal | academic | business | humorous | conversational | elegant | or custom string

# Word count threshold to trigger chunked translation
chunk_threshold: 4000

# Max words per chunk
chunk_max_words: 5000

# Custom glossary (merged with built-in glossary)
# CLI --glossary flag overrides these
glossary:
  - from: "Reinforcement Learning"
    to: "强化学习"
  - from: "Transformer"
    to: "Transformer"
    note: "Keep English"

# Language-pair specific glossaries
glossaries:
  en-zh:
    - from: "AI Agent"
      to: "AI 智能体"
  ja-zh:
    - from: "人工知能"
      to: "人工智能"
```

## Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `target_language` | string | `zh-CN` | Default target language code |
| `default_mode` | string | `normal` | Default translation mode (`quick` / `normal` / `refined`) |
| `audience` | string | `general` | Target reader profile (`general` / `technical` / `academic` / `business` / custom) |
| `style` | string | `storytelling` | Translation style (`storytelling` / `formal` / `technical` / `literal` / `academic` / `business` / `humorous` / `conversational` / `elegant` / custom) |
| `chunk_threshold` | number | `4000` | Word count threshold to trigger chunked translation |
| `chunk_max_words` | number | `5000` | Max words per chunk |
| `glossary` | array | `[]` | Universal glossary entries |
| `glossaries` | object | `{}` | Language-pair specific glossary entries |

## Glossary Entry

| Field | Required | Description |
|-------|----------|-------------|
| `from` | yes | Source term |
| `to` | yes | Target translation |
| `note` | no | Usage note (e.g., "Keep English", "Only in tech context") |

## Priority

1. CLI `--glossary` file entries
2. EXTEND.md `glossaries[pair]` entries
3. EXTEND.md `glossary` entries
4. Built-in glossary (e.g., `references/glossary-en-zh.md`)

Later entries override earlier ones for the same source term.
