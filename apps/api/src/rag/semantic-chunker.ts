export interface SemanticChunk {
  content: string;
  chunkIndex: number;
}

export class SemanticChunker {
  private readonly maxChunkSize: number;
  private readonly minChunkSize: number;

  constructor(maxChunkSize = 750, minChunkSize = 150) {
    this.maxChunkSize = maxChunkSize;
    this.minChunkSize = minChunkSize;
  }

  /**
   * Splits text respecting paragraph & sentence boundaries,
   * avoiding breaking sentences or thoughts in half.
   */
  chunk(text: string): SemanticChunk[] {
    const cleanText = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n');
    const paragraphs = cleanText.split(/\n\n+/);
    const chunks: string[] = [];
    let currentChunk = '';

    for (const paragraph of paragraphs) {
      const trimmed = paragraph.trim();
      if (!trimmed) continue;

      if (
        currentChunk.length + trimmed.length > this.maxChunkSize &&
        currentChunk.length >= this.minChunkSize
      ) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }

      if (trimmed.length > this.maxChunkSize) {
        // Split oversized paragraphs by sentence boundaries
        const sentences = trimmed.match(/[^.!?]+[.!?]+(\s|$)/g) || [trimmed];
        for (const sentence of sentences) {
          if (
            currentChunk.length + sentence.length > this.maxChunkSize &&
            currentChunk.length >= this.minChunkSize
          ) {
            chunks.push(currentChunk.trim());
            currentChunk = '';
          }
          currentChunk += (currentChunk ? ' ' : '') + sentence.trim();
        }
      } else {
        currentChunk += (currentChunk ? '\n\n' : '') + trimmed;
      }
    }

    if (currentChunk.trim().length > 0) {
      chunks.push(currentChunk.trim());
    }

    return chunks.map((content, chunkIndex) => ({
      content,
      chunkIndex,
    }));
  }
}