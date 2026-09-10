import { Module } from '@nestjs/common';
import { EmbeddingService } from './embedding.service';
import { VectorStoreService } from './vector-store.service';

@Module({
  providers: [EmbeddingService, VectorStoreService],
  exports: [EmbeddingService, VectorStoreService],
})
export class RagModule {}