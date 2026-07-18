# rich-markdown-bundle — with_skill

Prompt: Dry-run evals/files/rich.zip. Confirm that the versioned manifest, cover, Markdown, image signature, byte counts, and hashes are accepted, but do not compose or publish.

Command: `bun scripts/main.ts --bundle evals/files/rich.zip --dry-run`

Exit status: 0

```text
{
  "valid": true,
  "articleId": "eval-rich-markdown-article",
  "title": "Rich Markdown article",
  "characterCount": 273,
  "imageCount": 1,
  "coverPath": "images/cover.jpg",
  "warnings": []
}
```
