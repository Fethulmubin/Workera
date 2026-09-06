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
    const finalChunks: string[] = [];
    let separator = separators[separators.length - 1];
    let newSeparators: string[] = [];

    for (let i = 0; i < separators.length; i++) {
      const s = separators[i];
      if (s === '' || text.includes(s)) {
        separator = s;
        newSeparators = separators.slice(i + 1);
        break;
      }
    }

    const splits = separator === '' ? Array.from(text) : text.split(separator);
    let goodSplits: string[] = [];

    for (const s of splits) {
      if (s.length < this.chunkSize) {
        goodSplits.push(s);
      } else {
        if (goodSplits.length > 0) {
          finalChunks.push(goodSplits.join(separator).trim());
          goodSplits = [];
        }
        if (newSeparators.length === 0) {
          finalChunks.push(s.trim());
        } else {
          finalChunks.push(...this.split(s, newSeparators));
        }
      }
    }
    if (goodSplits.length > 0) {
      finalChunks.push(goodSplits.join(separator).trim());
    }
    return finalChunks.filter((c) => c.length > 0);
  }
}
