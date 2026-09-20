import { Module } from '@nestjs/common';
import { AgentsService } from './agents.service';
import { AgentsController } from './agents.controller';
import { TenantModule } from '../tenant/tenant.module';
import { RagModule } from '../rag/rag.module';
import { AgentExecutionService } from './agent-execution.service';

@Module({
  imports: [TenantModule, RagModule],
  controllers: [AgentsController],
  providers: [AgentsService, AgentExecutionService],
  exports: [AgentsService, AgentExecutionService],
})
export class AgentsModule {}