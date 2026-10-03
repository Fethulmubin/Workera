import { Module } from '@nestjs/common';
import { AgentsService } from './agents.service';
import { AgentsController } from './agents.controller';
import { TenantModule } from '../tenant/tenant.module';
import { RagModule } from '../rag/rag.module';
import { AuthModule } from '../auth/auth.module';
import { AgentExecutionService } from './agent-execution.service';
import { AgentSupervisorService } from './agent-supervisor.service';

@Module({
  imports: [TenantModule, RagModule, AuthModule],
  controllers: [AgentsController],
  providers: [AgentsService, AgentExecutionService, AgentSupervisorService],
  exports: [AgentsService, AgentExecutionService, AgentSupervisorService],
})
export class AgentsModule {}