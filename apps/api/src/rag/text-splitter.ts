/**
 * Utility for recursively splitting document text into overlapping chunks.
 */
export interface TextChunk {
  content: string;
  chunkIndex: number;
}

export function chunkText(text: string, chunkSize = 800, chunkOverlap = 150): TextChunk[] {
  const cleanText = text.replace(/\r\n/g, '\n').trim();
  if (!cleanText) return [];

  const chunks: TextChunk[] = [];
  let startIndex = 0;
  let chunkIndex = 0;

  while (startIndex < cleanText.length) {
    const endIndex = Math.min(startIndex + chunkSize, cleanText.length);
    const slice = cleanText.slice(startIndex, endIndex);

    chunks.push({
      content: slice,
      chunkIndex,
    });

    chunkIndex++;
    if (endIndex >= cleanText.length) break;
    startIndex += chunkSize - chunkOverlap;
  }

  return chunks;
}