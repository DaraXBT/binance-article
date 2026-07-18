declare module 'baoyu-md' {
  export interface ImagePlaceholder {
    originalPath: string;
    placeholder: string;
    alt?: string;
  }

  export function replaceMarkdownImagesWithPlaceholders(
    markdown: string,
    placeholderPrefix: string,
  ): { images: ImagePlaceholder[]; markdown: string };

  export function resolveImagePath(
    source: string,
    baseDir: string,
    tempDir: string,
    logPrefix?: string,
  ): Promise<string>;

  export function preprocessMermaidInMarkdown(
    markdown: string,
    options: {
      baseDir: string;
      renderFn: (
        code: string,
        outputPath: string,
        options?: Record<string, unknown>,
      ) => Promise<void>;
      onError?: (error: unknown, block: { code: string }) => void;
    },
  ): Promise<{ markdown: string; images: Array<{ cached?: boolean }> }>;
}
