export interface TextSplitterOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  separators?: string[];
}

export class RecursiveTextSplitter {
  private chunkSize: number;
  private chunkOverlap: number;
  private separators: string[];

  constructor(options: TextSplitterOptions = {}) {
    this.chunkSize = options.chunkSize ?? 500;
    this.chunkOverlap = options.chunkOverlap ?? 100;
    this.separators = options.separators ?? ['\n\n', '\n', ' ', ''];
  }

  splitText(text: string): string[] {
    if (!text || text.trim().length === 0) return [];
    return this.split(text, this.separators);
  }

  private split(text: string, separators: string[]): string[] {
    return [text.trim()];
  }
}
