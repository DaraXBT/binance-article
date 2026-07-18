import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function printUsage(): never {
  console.log(`Post to Binance Square using real Chrome browser

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
  --no-hashtags         Article mode: keep #tags as plain text
  --no-cointags         Article mode: keep $SYMBOLs as plain text
  --help                Show this help

Examples:
  npx -y bun main.ts "Hello Binance Square!"
  npx -y bun main.ts "Check this out" --image ./chart.png --submit
  npx -y bun main.ts --article ./article.md
  npx -y bun main.ts --article ./article.md --cover ./hero.png --submit
`);
  process.exit(0);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printUsage();
  }

  const isArticleMode = args.includes('--article');

  if (isArticleMode) {
    let markdownPath: string | undefined;
    let title: string | undefined;
    let coverImage: string | undefined;
    let submit = false;
    let profileDir: string | undefined;
    let chromePath: string | undefined;
    let hashtags = true;
    let coinTags = true;

    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;
      if (arg === '--article' && args[i + 1]) {
        markdownPath = args[++i];
      } else if (arg === '--title' && args[i + 1]) {
        title = args[++i];
      } else if (arg === '--cover' && args[i + 1]) {
        const raw = args[++i]!;
        coverImage = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
      } else if (arg === '--submit') {
        submit = true;
      } else if (arg === '--profile' && args[i + 1]) {
        profileDir = args[++i];
      } else if (arg === '--chrome-path' && args[i + 1]) {
        chromePath = args[++i];
      } else if (arg === '--no-hashtags') {
        hashtags = false;
      } else if (arg === '--no-cointags') {
        coinTags = false;
      }
    }

    if (!markdownPath) {
      console.error('Error: --article requires a Markdown file path');
      process.exit(1);
    }

    if (!fs.existsSync(markdownPath)) {
      console.error(`Error: File not found: ${markdownPath}`);
      process.exit(1);
    }

    const { publishArticle } = await import('./binance-article.js');
    await publishArticle({ markdownPath, title, coverImage, submit, profileDir, chromePath, hashtags, coinTags });
  } else {
    const images: string[] = [];
    const tags: string[] = [];
    let submit = false;
    let profileDir: string | undefined;
    let chromePath: string | undefined;
    const textParts: string[] = [];

    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;
      if (arg === '--image' && args[i + 1]) {
        images.push(args[++i]!);
      } else if (arg === '--tag' && args[i + 1]) {
        tags.push(args[++i]!);
      } else if (arg === '--submit') {
        submit = true;
      } else if (arg === '--profile' && args[i + 1]) {
        profileDir = args[++i];
      } else if (arg === '--chrome-path' && args[i + 1]) {
        chromePath = args[++i];
      } else if (!arg.startsWith('-')) {
        textParts.push(arg);
      }
    }

    const text = textParts.join(' ').trim() || undefined;

    if (!text && images.length === 0 && tags.length === 0) {
      console.error('Error: Provide text, --image, --tag, or use --article for long-form mode.');
      process.exit(1);
    }

    const { postToBinanceSquare } = await import('./binance-browser.js');
    await postToBinanceSquare({ text, images, tags, submit, profileDir, chromePath });
  }
}

await main().catch((err) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
