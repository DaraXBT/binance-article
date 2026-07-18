declare module 'front-matter' {
  export interface FrontMatterResult<T> {
    attributes: T;
    body: string;
    frontmatter: string;
  }

  export default function frontMatter<T = Record<string, unknown>>(content: string): FrontMatterResult<T>;
}
