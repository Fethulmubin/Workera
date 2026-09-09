import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export interface RetrievedChunk {
  id: string;
  documentId: string;
  documentTitle: string;
  content: string;
  similarity: number;
}

@Injectable()
export class VectorStoreService {
  constructor(private readonly prisma: PrismaService) {}

  async storeChunkWithEmbedding(
    documentId: string,
    content: string,
    chunkIndex: number,
    embedding: number[],
  ): Promise<void> {
    const vectorString = `[${embedding.join(',')}]`;
    const id = `chunk_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    await this.prisma.$executeRawUnsafe(
      `INSERT INTO "DocumentChunk" ("id", "documentId", "content", "chunkIndex", "embedding", "createdAt")
       VALUES ($1, $2, $3, $4, $5::vector, NOW())`,
      id,
      documentId,
      content,
      chunkIndex,
      vectorString,
    );
  }
}
