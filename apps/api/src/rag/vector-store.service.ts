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

  async similaritySearch(
    organizationId: string,
    queryEmbedding: number[],
    limit = 5,
    matchThreshold = 0.4,
    agentId?: string,
  ): Promise<RetrievedChunk[]> {
    if (agentId) {
      const agent = await this.prisma.agent.findFirst({
        where: { id: agentId, organizationId },
      });
      if (!agent) {
        return [];
      }
    }

    const vectorString = `[${queryEmbedding.join(',')}]`;

    const results = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM match_document_chunks($1::vector, $2::float, $3::int, $4::text, $5::text)`,
      vectorString,
      matchThreshold,
      limit,
      organizationId,
      agentId ?? null,
    );

    return results.map((r) => ({
      id: r.id,
      documentId: r.document_id,
      documentTitle: r.document_title,
      content: r.content,
      similarity: Number(r.similarity),
    }));
  }
}
