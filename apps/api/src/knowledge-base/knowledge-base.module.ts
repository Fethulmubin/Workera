import { Module } from '@nestjs/common';
import { KnowledgeBaseService } from './knowledge-base.service';
import { KnowledgeBaseController } from './knowledge-base.controller';
import { TenantModule } from '../tenant/tenant.module';
import { StorageModule } from '../storage/storage.module';
import { RagModule } from '../rag/rag.module';

@Module({
  imports: [TenantModule, StorageModule, RagModule],
  controllers: [KnowledgeBaseController],
  providers: [KnowledgeBaseService],
  exports: [KnowledgeBaseService],
})
export class KnowledgeBaseModule {}