# standard-bundle — with_skill

Prompt: Validate evals/files/standard.zip for Binance Square without opening Chrome or publishing anything. Report the title, body character count, image count, and whether it is safe to prepare.

Command: `bun scripts/main.ts --bundle evals/files/standard.zip --dry-run`

Exit status: 0

```text
{
  "valid": true,
  "articleId": "eval-standard-article",
  "title": "Standard article",
  "characterCount": 91,
  "imageCount": 1,
  "coverPath": "images/cover.jpg",
  "warnings": []
}
```
