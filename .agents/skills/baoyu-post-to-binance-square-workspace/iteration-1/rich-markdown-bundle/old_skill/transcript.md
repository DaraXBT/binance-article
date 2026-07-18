# rich-markdown-bundle — old_skill

Prompt: Dry-run evals/files/rich.zip. Confirm that the versioned manifest, cover, Markdown, image signature, byte counts, and hashes are accepted, but do not compose or publish.

Command: `bun scripts/main.ts --help (v1.0 baseline; bundle dry-run is unavailable)`

Exit status: 0

```text
Post to Binance Square using real Chrome browser

Usage:
  # Regular post (text + optional images)
  npx -y bun main.ts "Post text" [--image ./photo.png] [--submit]

  # Long-form article from Markdown
  npx -y bun main.ts --article article.md [--cover ./cover.jpg] [--title "Override Title"] [--submit]

Options:
  --article <file>      Markdown file for long-form article mode
  --image <path>        Image file for regular post (can be repeated)
  --tag <hashtag>       Hashtag to append (can be repeated, # optional)
  --cover <path>        Cover image for article (overrides frontmatter)
  --title <text>        Override title (article mode only)
  --submit              Auto-publish after composing (default: preview only)
  --profile <dir>       Custom Chrome profile directory
  --chrome-path <path>  Override Chrome executable path
  --help                Show this help

Examples:
  npx -y bun main.ts "Hello Binance Square!"
  npx -y bun main.ts "Check this out" --image ./chart.png --submit
  npx -y bun main.ts --article ./article.md
  npx -y bun main.ts --article ./article.md --cover ./hero.png --submit
```
