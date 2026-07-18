/**
 * Small, dependency-free Markdown image scanner used at the bundle boundary.
 *
 * The bundle contract intentionally permits only the inline image form
 * (`![alt](path)`). Anything else is rejected rather than silently becoming a
 * different image source during browser composition.
 */

export interface MarkdownImageReference {
  alt: string;
  destination: string;
}

export interface MarkdownImageInspection {
  references: MarkdownImageReference[];
  hiddenImageReferences: string[];
  rawHtmlImageSources: string[];
  unsafeRawHtmlTags: string[];
  containsMermaidBlock: boolean;
  unsupportedImageSyntax: boolean;
}

const RAW_IMG_TAG = /<img\b[^>]*>/giu;
const RAW_IMG_SRC = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/iu;
const RAW_HTML_TAG = /<\/?[A-Za-z][A-Za-z0-9:-]*(?:\s[^>]*)?\/?>/gu;
const SAFE_FORMATTING_HTML = /^<\/?(?:u|br|b|strong|i|em|s|del|sub|sup|mark|kbd)\s*\/?>$/iu;
const MERMAID_FENCE = /(?:^|\n)[^\n]*(?:`{3,}|~{3,})[ \t]*mermaid[^\s]*/u;

function isEscaped(value: string, index: number): boolean {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && value[i] === '\\'; i -= 1) backslashes += 1;
  return backslashes % 2 === 1;
}

function hiddenImageReferences(value: string): string[] {
  const matches: string[] = [];
  const patterns = [
    /!\[\[([^\]\n]+)\]\]/gu,
    /!\[[^\]]*\]\(([^)]*)\)/gu,
    /!\[[^\]]*\]\[([^\]]*)\]/gu,
  ];
  for (const pattern of patterns) {
    for (const match of value.matchAll(pattern)) {
      matches.push((match[1] ?? '').trim() || 'image syntax');
    }
  }
  return matches;
}

function maskFencedAndIndentedCode(markdown: string): {
  masked: string;
  hidden: string[];
  containsMermaidBlock: boolean;
} {
  const lines = markdown.match(/[^\n]*(?:\n|$)/g) ?? [];
  const output: string[] = [];
  const hidden: string[] = [];
  // Use a deliberately conservative raw-line check as well as the structured
  // fence walk so Mermaid nested under blockquotes/lists cannot reach the
  // renderer and generate an unmanifested image.
  let containsMermaidBlock = MERMAID_FENCE.test(markdown);
  let fence: { char: '`' | '~'; length: number } | null = null;

  for (const line of lines) {
    const withoutNewline = line.endsWith('\n') ? line.slice(0, -1) : line;
    if (fence) {
      const close = new RegExp(`^\\s{0,3}\\${fence.char}{${fence.length},}\\s*$`);
      if (close.test(withoutNewline)) {
        output.push(line.replace(/[^\n]/g, ' '));
        fence = null;
      } else {
        hidden.push(...hiddenImageReferences(withoutNewline));
        output.push(line.replace(/[^\n]/g, ' '));
      }
      continue;
    }

    const opening = withoutNewline.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (opening) {
      const marker = opening[1]!;
      const infoString = withoutNewline.slice(opening[0].length).trim();
      if (infoString.startsWith('mermaid')) containsMermaidBlock = true;
      hidden.push(...hiddenImageReferences(infoString));
      output.push(line.replace(/[^\n]/g, ' '));
      fence = { char: marker[0] as '`' | '~', length: marker.length };
      continue;
    }

    // Four-space/tab indented blocks are code in CommonMark.  Masking them
    // also keeps the publisher's image scanner from treating code as content.
    if (/^(?: {4}|\t)/.test(withoutNewline)) {
      hidden.push(...hiddenImageReferences(withoutNewline));
      output.push(line.replace(/[^\n]/g, ' '));
    } else {
      output.push(line);
    }
  }

  return { masked: output.join(''), hidden, containsMermaidBlock };
}

function maskInlineCode(markdown: string): { masked: string; hidden: string[] } {
  // Code-unit indexing keeps positions aligned with `isEscaped` and slice.
  const chars = markdown.split('');
  const hidden: string[] = [];
  let i = 0;
  while (i < chars.length) {
    if (chars[i] !== '`' || isEscaped(markdown, i)) {
      i += 1;
      continue;
    }
    let length = 1;
    while (chars[i + length] === '`') length += 1;
    let end = i + length;
    let closing = -1;
    while (end < chars.length) {
      if (chars[end] !== '`' || isEscaped(markdown, end)) {
        end += 1;
        continue;
      }
      let run = 1;
      while (chars[end + run] === '`') run += 1;
      if (run === length) {
        closing = end;
        break;
      }
      end += run;
    }
    if (closing < 0) {
      i += length;
      continue;
    }
    hidden.push(...hiddenImageReferences(chars.slice(i + length, closing).join('')));
    for (let j = i; j < closing + length; j += 1) {
      if (chars[j] !== '\n') chars[j] = ' ';
    }
    i = closing + length;
  }
  return { masked: chars.join(''), hidden };
}

function findClosingBracket(value: string, opening: number): number {
  // Match baoyu-md's `[^\]]*` image-alt parser exactly. Balancing nested
  // brackets here would let validation approve the outer destination while
  // the publisher resolves an earlier, attacker-controlled destination.
  return value.indexOf(']', opening + 1);
}

function findClosingParen(value: string, opening: number): number {
  // Match baoyu-md's `[^)]*` destination parser for the same reason.
  return value.indexOf(')', opening + 1);
}

function parseDestination(value: string, opening: number): { destination: string; end: number } | null {
  const end = findClosingParen(value, opening);
  if (end < 0) return null;
  const inside = value.slice(opening + 1, end).trim();
  if (!inside) return { destination: '', end };

  // baoyu-md treats everything before the first `)` as the local path.  Keep
  // titles, angle brackets, and escapes in the value so they fail the exact
  // manifest comparison instead of resolving differently downstream.
  return { destination: inside, end };
}

export function inspectMarkdownImageReferences(markdown: string): MarkdownImageInspection {
  const fenced = maskFencedAndIndentedCode(markdown);
  const inline = maskInlineCode(fenced.masked);
  const masked = inline.masked;
  const hiddenImageReferences = [...fenced.hidden, ...inline.hidden];
  const references: MarkdownImageReference[] = [];
  let unsupportedImageSyntax = false;

  for (let i = 0; i < masked.length - 1; i += 1) {
    if (masked[i] !== '!' || masked[i + 1] !== '[') continue;
    if (isEscaped(masked, i)) {
      // baoyu-md's image regex does not honor the Markdown escape and would
      // still upload this destination, so escaped image forms are unsafe.
      unsupportedImageSyntax = true;
      continue;
    }
    const closeBracket = findClosingBracket(masked, i + 1);
    if (closeBracket < 0) {
      unsupportedImageSyntax = true;
      break;
    }
    const alt = masked.slice(i + 2, closeBracket);
    if (masked[closeBracket + 1] !== '(') {
      unsupportedImageSyntax = true;
      i = closeBracket;
      continue;
    }
    const parsed = parseDestination(masked, closeBracket + 1);
    if (!parsed) {
      unsupportedImageSyntax = true;
      break;
    }
    references.push({ alt, destination: parsed.destination });
    i = parsed.end;
  }

  const rawHtmlImageSources: string[] = [];
  for (const match of masked.matchAll(RAW_IMG_TAG)) {
    const tag = match[0];
    const src = tag.match(RAW_IMG_SRC);
    rawHtmlImageSources.push(src?.[1] ?? src?.[2] ?? src?.[3] ?? '');
  }
  const unsafeRawHtmlTags = [...masked.matchAll(RAW_HTML_TAG)]
    .map((match) => match[0])
    .filter((tag) => !SAFE_FORMATTING_HTML.test(tag));

  return {
    references,
    hiddenImageReferences,
    rawHtmlImageSources,
    unsafeRawHtmlTags,
    containsMermaidBlock: fenced.containsMermaidBlock,
    unsupportedImageSyntax,
  };
}

export function getMarkdownImageReferenceErrors(
  markdown: string,
  expectedPaths: readonly string[],
  label: string,
): string[] {
  const inspection = inspectMarkdownImageReferences(markdown);
  const errors: string[] = [];
  const expected = new Set(expectedPaths);
  const counts = new Map<string, number>();

  if (inspection.rawHtmlImageSources.length > 0) {
    errors.push(`${label} cannot contain raw HTML image tags.`);
  }
  if (inspection.unsafeRawHtmlTags.length > 0) {
    errors.push(`${label} contains unsupported raw HTML; use Markdown or plain formatting tags only.`);
  }
  if (inspection.containsMermaidBlock) {
    errors.push(`${label} cannot contain Mermaid blocks because every bundle image must be listed in the manifest.`);
  }
  if (inspection.unsupportedImageSyntax) {
    errors.push(`${label} contains unsupported image syntax; use ![alt](images/file.ext).`);
  }
  for (const hidden of new Set(inspection.hiddenImageReferences)) {
    errors.push(`${label} contains image syntax inside code: ${hidden}.`);
  }

  for (const reference of inspection.references) {
    const destination = reference.destination;
    if (!expected.has(destination)) {
      errors.push(`${label} contains an unbundled or unsafe image destination: ${destination || '(empty)'}.`);
      continue;
    }
    counts.set(destination, (counts.get(destination) ?? 0) + 1);
  }

  for (const expectedPath of expectedPaths) {
    if ((counts.get(expectedPath) ?? 0) !== 1) {
      errors.push(`${label} must reference the bundled image ${expectedPath} exactly once.`);
    }
  }
  return [...new Set(errors)];
}
