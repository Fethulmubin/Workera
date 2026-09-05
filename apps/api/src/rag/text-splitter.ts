export interface TextSplitterOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  separators?: string[];
}

export class RecursiveTextSplitter {
  private chunkSize: number;
  private chunkOverlap: number;

  constructor(options: TextSplitterOptions = {}) {
    this.chunkSize = options.chunkSize ?? 500;
    this.chunkOverlap = options.chunkOverlap ?? 100;
  }
}
