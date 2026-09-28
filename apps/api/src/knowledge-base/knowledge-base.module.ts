import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { KnowledgeBaseService } from './knowledge-base.service';
import { KnowledgeBaseController } from './knowledge-base.controller';
import { IngestionProcessor } from './ingestion.processor';
import { DOCUMENT_INGESTION_QUEUE } from './ingestion.queue';
import { TenantModule } from '../tenant/tenant.module';
import { StorageModule } from '../storage/storage.module';
import { RagModule } from '../rag/rag.module';

@Module({
  imports: [
    TenantModule,
    StorageModule,
    RagModule,
    BullModule.registerQueue({
      name: DOCUMENT_INGESTION_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    }),
  ],
  controllers: [KnowledgeBaseController],
  providers: [KnowledgeBaseService, IngestionProcessor],
  exports: [KnowledgeBaseService],
})
export class KnowledgeBaseModule {}