# malicious-traversal — with_skill

Prompt: Dry-run evals/files/malicious-traversal.zip and explain whether it can be used. Do not extract unsafe content and do not open Chrome.

Command: `bun scripts/main.ts --bundle evals/files/malicious-traversal.zip --dry-run`

Exit status: 1

```text
Error: Unsafe bundle path: ../cookies.json.
```
