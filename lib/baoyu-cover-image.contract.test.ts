import { existsSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const coverSkillDirectory = resolve(root, '.agents/skills/baoyu-cover-image');
const coverReferencesDirectory = resolve(coverSkillDirectory, 'references');

const binancePresets = [
  { name: 'binance', palette: 'binance', rendering: 'isometric' },
  { name: 'binance-master', palette: 'binance', rendering: 'isometric' },
  { name: 'binance-briefing', palette: 'binance', rendering: 'isometric' },
  { name: 'binance-mondo-panoramic', palette: 'binance', rendering: 'screen-print' },
  { name: 'binance-sketch-notes', palette: 'binance', rendering: 'hand-drawn' },
  { name: 'binance-vector-illustration', palette: 'binance', rendering: 'flat-vector' },
] as const;

function readRepositoryFile(path: string) {
  return readFileSync(resolve(root, path), 'utf8');
}

function markdownTableRows(source: string) {
  return source
    .split('\n')
    .filter((line) => line.startsWith('|') && !/^\|[-|]+\|$/.test(line.replaceAll(' ', '')))
    .map((line) => line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim().replaceAll('`', '').replace(/[\u00B9\u00B2\u00B3\u2070-\u2079]/g, '')));
}

function firstMarkdownFrontmatter(source: string) {
  const match = source.match(/```markdown\s*\n---\n([\s\S]*?)\n---/);
  expect(match, 'prompt template must contain a fenced Markdown frontmatter example').not.toBeNull();
  return match?.[1] ?? '';
}

async function markdownFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return extname(entry.name) === '.md' ? [path] : [];
  }));
  return nested.flat();
}

describe('Baoyu Binance cover contracts', () => {
  it('maps every Binance preset to its palette, rendering, and resolvable specification', () => {
    const catalog = readRepositoryFile(
      '.agents/skills/baoyu-cover-image/references/style-presets.md',
    );
    const rows = new Map(markdownTableRows(catalog).map((row) => [row[0], row]));

    for (const preset of binancePresets) {
      expect(rows.get(preset.name), `missing preset row for ${preset.name}`).toEqual([
        preset.name,
        preset.palette,
        preset.rendering,
      ]);

      const specificationLink = `styles/${preset.name}.md`;
      expect(catalog).toContain(`[\`${preset.name}\`](${specificationLink})`);

      const specificationPath = resolve(coverReferencesDirectory, specificationLink);
      expect(existsSync(specificationPath), `missing specification ${specificationLink}`).toBe(true);

      const specification = readFileSync(specificationPath, 'utf8');
      expect(specification).toMatch(new RegExp(`^# ${preset.name}$`, 'm'));
      expect(specification).toContain(
        `palette [\`${preset.palette}\`](../palettes/${preset.palette}.md)`,
      );
      expect(specification).toContain(
        `rendering [\`${preset.rendering}\`](../renderings/${preset.rendering}.md)`,
      );
      expect(existsSync(resolve(coverReferencesDirectory, `palettes/${preset.palette}.md`))).toBe(true);
      expect(existsSync(resolve(coverReferencesDirectory, `renderings/${preset.rendering}.md`))).toBe(true);
    }
  });

  it('keeps binance-master as the project default for covers and article illustrations', () => {
    const coverPreferences = readRepositoryFile('.baoyu-skills/baoyu-cover-image/EXTEND.md');
    const illustrationPreferences = readRepositoryFile(
      '.baoyu-skills/baoyu-article-illustrator/EXTEND.md',
    );

    expect(coverPreferences).toMatch(/^preferred_style:\s*binance-master\s*$/m);
    expect(coverPreferences).toMatch(/^preferred_style_mode:\s*null\s*$/m);
    expect(coverPreferences).toMatch(/^preferred_text:\s*none\s*$/m);
    expect(coverPreferences).toMatch(/^default_aspect:\s*"5:2"\s*$/m);
    expect(coverPreferences).toMatch(/^quick_mode:\s*true\s*$/m);
    expect(illustrationPreferences).toMatch(
      /^preferred_style:\s*\n\s+name:\s*binance-master\s*$/m,
    );
  });

  it('requires named style metadata and constrains binance-master prompt modes', () => {
    const promptTemplate = readRepositoryFile(
      '.agents/skills/baoyu-cover-image/references/workflow/prompt-template.md',
    );
    const frontmatter = firstMarkdownFrontmatter(promptTemplate);

    expect(frontmatter).toMatch(/^type:\s*cover\s*$/m);
    expect(frontmatter).toMatch(/^style:\s*\[confirmed named style, or custom\]\s*$/m);
    expect(frontmatter).toMatch(
      /^style_mode:\s*\[scene \| mechanism \| briefing \| primer; include only for binance-master\]\s*$/m,
    );
    expect(promptTemplate).toContain(
      'Omit `style_mode` entirely unless the chosen named style defines modes.',
    );
    expect(promptTemplate).toContain(
      'For `binance-master`, include exactly one of `scene`, `mechanism`, `briefing`, or `primer`.',
    );
    expect(promptTemplate).toContain(
      'Authoritative style reference: [../styles/{style}.md, or "none"]',
    );
  });

  it('keeps the Binance output contract and its postprocessor reference aligned', () => {
    const skill = readRepositoryFile('.agents/skills/baoyu-cover-image/SKILL.md');
    const promptTemplate = readRepositoryFile(
      '.agents/skills/baoyu-cover-image/references/workflow/prompt-template.md',
    );
    const postprocessorPath = resolve(
      coverSkillDirectory,
      'scripts/prepare-binance-cover.ts',
    );

    for (const contractText of [
      '5:2 safe frame',
      '`2.35:1` source',
      '1000x400',
      'quality 92',
      '10 MiB',
    ]) {
      expect(skill).toContain(contractText);
      expect(promptTemplate).toContain(contractText.replaceAll('`', ''));
    }

    expect(skill).toContain('cover-source.{ext}');
    expect(skill).toContain('scripts/prepare-binance-cover.ts');
    expect(existsSync(postprocessorPath), 'referenced Binance cover postprocessor must exist').toBe(true);
  });

  it('keeps every cover-skill Markdown reference resolvable', async () => {
    const failures: string[] = [];

    for (const file of await markdownFiles(coverSkillDirectory)) {
      const markdown = readFileSync(file, 'utf8');
      for (const match of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
        const target = match[1]?.trim();
        if (!target || target.startsWith('#') || /^[a-z]+:/i.test(target)) continue;
        const withoutAnchor = target.split('#', 1)[0];
        if (!withoutAnchor || withoutAnchor.includes('{')) continue;
        if (!existsSync(resolve(dirname(file), withoutAnchor))) {
          failures.push(`${file.slice(root.length + 1)} -> ${target}`);
        }
      }
    }

    expect(failures).toEqual([]);
  });
});
