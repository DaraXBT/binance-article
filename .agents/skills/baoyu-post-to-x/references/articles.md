# X Articles - Detailed Guide

Publish Markdown articles to X Articles editor with rich text formatting and images.

## Prerequisites

- X Premium subscription (required for Articles)
- Google Chrome installed
- `bun` installed

## Usage

```bash
# Publish markdown article (preview mode)
${BUN_X} ${SKILL_DIR}/scripts/x-article.ts article.md

# With custom cover image
${BUN_X} ${SKILL_DIR}/scripts/x-article.ts article.md --cover ./cover.jpg

# Actually publish
${BUN_X} ${SKILL_DIR}/scripts/x-article.ts article.md --submit
```

## Markdown Format

```markdown
---
title: My Article Title
cover_image: /path/to/cover.jpg
---

# Title (becomes article title)

Regular paragraph text with **bold** and *italic*.

## Section Header

More content here.

![Image alt text](./image.png)

- List item 1
- List item 2

1. Numbered item
2. Another item

> Blockquote text

[Link text](https://example.com)

\`\`\`
Code blocks become blockquotes (X doesn't support code)
\`\`\`
```

## Frontmatter Fields

| Field | Description |
|-------|-------------|
| `title` | Article title (or uses first H1) |
| `cover_image` | Cover image path or URL |
| `cover` | Alias for cover_image |
| `image` | Alias for cover_image |

## Image Handling

1. **Cover Image**: First image or `cover_image` from frontmatter
2. **Remote Images**: Automatically downloaded to temp directory
3. **Placeholders**: Images in content use collision-resistant `X_<random>_IMG_N` tokens
4. **Insertion**: Placeholders are found, selected, and replaced with actual images

## Markdown to HTML Script

Convert markdown and inspect structure:

```bash
# Get JSON with all metadata
${BUN_X} ${SKILL_DIR}/scripts/md-to-html.ts article.md

# Output HTML only
${BUN_X} ${SKILL_DIR}/scripts/md-to-html.ts article.md --html-only

# Save HTML to file
${BUN_X} ${SKILL_DIR}/scripts/md-to-html.ts article.md --save-html /tmp/article.html
```

JSON output:
```json
{
  "title": "Article Title",
  "coverImage": "/path/to/cover.jpg",
  "contentImages": [
    {
      "placeholder": "X_A1B2C3D4E5F60708_IMG_1",
      "localPath": "/tmp/x-article-images/img.png",
      "blockIndex": 5
    }
  ],
  "html": "<p>Content...</p>",
  "totalBlocks": 20
}
```

## Supported Formatting

| Markdown | HTML Output |
|----------|-------------|
| `# H1` | Title only (not in body) |
| `## H2` - `###### H6` | `<h2>` |
| `**bold**` | `<strong>` |
| `*italic*` | `<em>` |
| `[text](url)` | `<a href>` |
| `> quote` | `<blockquote>` |
| `` `code` `` | `<code>` |
| ```` ``` ```` | `<blockquote>` (X limitation) |
| `- item` | `<ul><li>` |
| `1. item` | `<ol><li>` |
| `![](img)` | Image placeholder |

## Workflow

1. **Parse Markdown**: Extract title, cover, content images, generate HTML
2. **Launch Chrome**: Real browser with CDP, persistent login
3. **Navigate**: Open `x.com/compose/articles`
4. **Create Article**: Click create button if on list page
5. **Upload Cover**: Use file input for cover image
6. **Fill Title**: Type title into title field
7. **Paste Content**: Copy HTML to clipboard, paste into editor
8. **Insert Images**: For each namespaced placeholder in document order:
   - Find placeholder text in editor
   - Select the placeholder
   - Copy image to clipboard
   - Paste to replace selection
9. **Post-Composition Check** (automatic):
   - Require exact reviewed title and normalized body text after save
   - Reject any remaining namespaced placeholders
   - Require exact body-image count and insertion-source order
   - Require a newly applied visible cover when reviewed
   - Stop before review/publish on any mismatch
10. **Review**: Browser stays open for 60s preview
11. **Publish**: Only with `--submit` flag

## Example Session

```
User: /post-to-x article ./blog/my-post.md --cover ./thumbnail.png

Claude:
1. Parses markdown: title="My Post", 3 content images
2. Launches Chrome with CDP
3. Navigates to x.com/compose/articles
4. Clicks create button
5. Uploads thumbnail.png as cover
6. Fills title "My Post"
7. Pastes HTML content
8. Inserts 3 images at placeholder positions
9. Reports: "Article composed. Review and use --submit to publish."
```

## Troubleshooting

- **No create button**: Ensure X Premium subscription is active
- **Cover upload fails**: Check file path and format (PNG, JPEG)
- **Images not inserting**: Verify placeholders exist in pasted content
- **Content not pasting**: Check HTML clipboard: `${BUN_X} ${SKILL_DIR}/scripts/copy-to-clipboard.ts html --file /tmp/test.html`

## How It Works

1. `md-to-html.ts` converts Markdown to HTML:
   - Extracts frontmatter (title, cover)
   - Converts markdown to HTML
   - Replaces images with unique placeholders
   - Downloads remote images locally
   - Returns structured JSON

2. `x-article.ts` publishes via CDP:
   - Launches real Chrome (bypasses detection)
   - Uses persistent profile (saved login)
   - Navigates and fills editor via DOM manipulation
   - Pastes HTML from system clipboard
   - Finds/selects/replaces each image placeholder
