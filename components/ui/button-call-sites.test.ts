import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function sourceFiles(directory: string): string[] {
  return readdirSync(directory)
    .flatMap((entry) => {
      const path = join(directory, entry);
      return statSync(path).isDirectory() ? sourceFiles(path) : [path];
    })
    .filter((path) => path.endsWith('.tsx') && !path.endsWith('.test.tsx'));
}

function openingTags(source: string, componentName: string): string[] {
  const tags: string[] = [];
  const marker = `<${componentName}`;
  let searchFrom = 0;

  while (searchFrom < source.length) {
    const start = source.indexOf(marker, searchFrom);
    if (start === -1) break;

    let braceDepth = 0;
    let quote: '"' | "'" | '`' | null = null;
    let escaped = false;

    for (let index = start + marker.length; index < source.length; index += 1) {
      const character = source[index];

      if (quote) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === quote) quote = null;
        continue;
      }

      if (character === '"' || character === "'" || character === '`') quote = character;
      else if (character === '{') braceDepth += 1;
      else if (character === '}') braceDepth -= 1;
      else if (character === '>' && braceDepth === 0) {
        tags.push(source.slice(start, index + 1));
        searchFrom = index + 1;
        break;
      }
    }

    if (searchFrom <= start) break;
  }

  return tags;
}

function isFlatButton(tag: string) {
  return /variant\s*=\s*(?:["'](?:ghost|link)["']|\{\s*["'](?:ghost|link)["']\s*\})/.test(tag);
}

describe('Button call-site material contract', () => {
  it('does not let local utility classes replace shared raised materials', () => {
    const files = [resolve(root, 'app'), resolve(root, 'components')].flatMap(sourceFiles);
    const conflicts: string[] = [];
    const conflictingUtility = /(?:\bbg-|\b(?:hover:|dark:hover:)?bg-|\bshadow-(?!none\b)|\bshadow-none\b|\bborder-dotted\b|\bborder-(?:border|input|primary|sidebar|destructive)[^\s"'`}]*|\brounded-none\b|\bhover:brightness)/;

    for (const file of files) {
      for (const tag of openingTags(readFileSync(file, 'utf8'), 'Button')) {
        if (!isFlatButton(tag) && conflictingUtility.test(tag)) {
          conflicts.push(`${relative(root, file)}: ${tag.replace(/\s+/g, ' ')}`);
        }
        if (/\brounded-(?:none|xl|2xl|3xl|full)\b/.test(tag)) {
          conflicts.push(`${relative(root, file)}: ${tag.replace(/\s+/g, ' ')}`);
        }
      }

      for (const tag of openingTags(readFileSync(file, 'utf8'), 'ThemeToggle')) {
        if (/\bbg-|\bshadow-|\bborder-(?:border|input|primary|sidebar|destructive)/.test(tag)) {
          conflicts.push(`${relative(root, file)}: ${tag.replace(/\s+/g, ' ')}`);
        }
      }

      for (const componentName of ['AlertDialogAction', 'AlertDialogCancel']) {
        for (const tag of openingTags(readFileSync(file, 'utf8'), componentName)) {
          if (/\bborder-dotted\b|\brounded-none\b|\bshadow-none\b|\bbg-/.test(tag)) {
            conflicts.push(`${relative(root, file)}: ${tag.replace(/\s+/g, ' ')}`);
          }
        }
      }
    }

    expect(conflicts).toEqual([]);
  });

  it('does not flatten future material variants in the shared input-group adapter', () => {
    const source = readFileSync(resolve(root, 'components/ui/input-group.tsx'), 'utf8');

    expect(source).not.toMatch(/inputGroupButtonVariants\s*=\s*cva\(\s*['"][^'"]*shadow-none/);
  });
});
