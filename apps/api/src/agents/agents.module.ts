import { Module } from "@nestjs/common";
import { AgentsService } from "./agents.service";
import { AgentsController } from "./agents.controller";
import { PublicAgentsController } from "./public-agents.controller";
import { PublicChatRateLimitGuard } from "./guards/public-chat-rate-limit.guard";
import { TenantModule } from "../tenant/tenant.module";
import { RagModule } from "../rag/rag.module";
import { AuthModule } from "../auth/auth.module";
import { AgentExecutionService } from "./agent-execution.service";
import { AgentSupervisorService } from "./agent-supervisor.service";
import { LLMModule } from "../llm/llm.module";

@Module({
  imports: [TenantModule, RagModule, AuthModule, LLMModule],
  controllers: [AgentsController, PublicAgentsController],
  providers: [
    AgentsService,
    AgentExecutionService,
    AgentSupervisorService,
    PublicChatRateLimitGuard,
  ],
  exports: [
    AgentsService,
    AgentExecutionService,
    AgentSupervisorService,
    PublicChatRateLimitGuard,
  ],
})
export class AgentsModule {}
