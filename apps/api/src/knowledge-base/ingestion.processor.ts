import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../database/prisma.service';
import { EmbeddingService } from '../rag/embedding.service';
import { VectorStoreService } from '../rag/vector-store.service';
import { SemanticChunker } from '../rag/semantic-chunker';
import { DOCUMENT_INGESTION_QUEUE, DocumentIngestionJobData } from './ingestion.queue';
import { DocumentStatus } from '@prisma/client';

@Processor(DOCUMENT_INGESTION_QUEUE, {
  concurrency: 2, // Process up to 2 documents concurrently to protect Gemini/OpenRouter rate limits
})
export class IngestionProcessor extends WorkerHost {
  private readonly logger = new Logger(IngestionProcessor.name);
  private readonly chunker = new SemanticChunker(750, 150);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingService: EmbeddingService,
    private readonly vectorStoreService: VectorStoreService,
  ) {
    super();
  }

  async process(job: Job<DocumentIngestionJobData>): Promise<void> {
    const { documentId, rawText } = job.data;
    this.logger.log(
      `[Worker] Starting background processing for Document: ${documentId} (Job: ${job.id})`,
    );

    try {
      // 1. Mark status as PROCESSING
      await this.prisma.document.update({
        where: { id: documentId },
        data: { status: DocumentStatus.PROCESSING },
      });

      // 2. Semantic Chunking
      const chunks = this.chunker.chunk(rawText);
      this.logger.log(
        `[Worker] Generated ${chunks.length} semantic chunks for Document: ${documentId}`,
      );

      if (chunks.length === 0) {
        throw new Error('No valid chunks generated from document text');
      }

      // 3. Batch Vector Embedding generation
      const textsToEmbed = chunks.map((c) => c.content);
      const embeddings = await this.embeddingService.generateEmbeddings(textsToEmbed);

      // 4. Insert into pgvector
      for (let i = 0; i < chunks.length; i++) {
        await this.vectorStoreService.storeChunkWithEmbedding(
          documentId,
          chunks[i].content,
          chunks[i].chunkIndex,
          embeddings[i],
        );
      }

      // 5. Mark status as READY
      await this.prisma.document.update({
        where: { id: documentId },
        data: { status: DocumentStatus.READY },
      });

      this.logger.log(`[Worker] Document ${documentId} successfully ingested and ready for RAG!`);
    } catch (err: any) {
      this.logger.error(
        `[Worker] Document ${documentId} processing failed: ${err.message}`,
        err.stack,
      );

      await this.prisma.document.update({
        where: { id: documentId },
        data: {
          status: DocumentStatus.FAILED,
          errorMessage: err.message || 'Unknown processing error',
        },
      });

      // Re-throw so BullMQ tracks the failure and triggers retry backoff
      throw err;
    }
  }
}