import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Res,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { Observable } from 'rxjs';
import { AgentsService } from './agents.service';
import { CreateAgentDto } from './dto/create-agent.dto';
import { UpdateAgentDto } from './dto/update-agent.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenant/tenant.guard';
import { CurrentTenant } from '../tenant/current-tenant.decorator';
import type { TenantContext } from '../tenant/tenant.types';
import { AgentExecutionService } from './agent-execution.service';

@Controller('agents')
@UseGuards(JwtAuthGuard, TenantGuard)
export class AgentsController {
  constructor(private readonly agentsService: AgentsService,
    private readonly agentExecutionService: AgentExecutionService) {}
  @Post()
  async create(
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: CreateAgentDto,
  ) {
    return this.agentsService.createAgent(tenant.organizationId, dto);
  }

  @Get()
  async list(@CurrentTenant() tenant: TenantContext) {
    return this.agentsService.listAgentsByOrganization(tenant.organizationId);
  }

  @Get(':agentId')
  async getOne(
    @CurrentTenant() tenant: TenantContext,
    @Param('agentId') agentId: string,
  ) {
    return this.agentsService.getAgentById(tenant.organizationId, agentId);
  }

  @Patch(':agentId')
  async update(
    @CurrentTenant() tenant: TenantContext,
    @Param('agentId') agentId: string,
    @Body() dto: UpdateAgentDto,
  ) {
    return this.agentsService.updateAgent(tenant.organizationId, agentId, dto);
  }

  @Delete(':agentId')
  async remove(
    @CurrentTenant() tenant: TenantContext,
    @Param('agentId') agentId: string,
  ) {
    return this.agentsService.deleteAgent(tenant.organizationId, agentId);
  }

  @Post(':id/chat')
async chatWithAgent(
  @CurrentTenant() tenant: TenantContext,
  @Param('id') agentId: string,
  @Body() body: { message: string; conversationId?: string },
) {
  if (!body.message) {
    throw new BadRequestException('Message is required');
  }
  return this.agentExecutionService.executeChat(
    tenant.organizationId,
    agentId,
    body.message,
    body.conversationId,
  );
}

@Post(':id/chat/stream')
chatStreamWithAgent(
  @CurrentTenant() tenant: TenantContext,
  @Param('id') agentId: string,
  @Body() body: { message: string; conversationId?: string },
  @Res() res: Response,
): void {
  if (!body.message) {
    throw new BadRequestException('Message is required');
  }

  // 1. Set standard SSE headers for chunked HTTP streaming
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disables Nginx buffering if deployed behind a proxy

  // 2. Fetch the stream from service
  const stream$ = this.agentExecutionService.executeChatStream(
    tenant.organizationId,
    agentId,
    body.message,
    body.conversationId,
  );

  // 3. Subscribe to the Observable and write SSE formatted data blocks
  const subscription = stream$.subscribe({
    next: (event) => {
      res.write(`data: ${event.data}\n\n`);
    },
    error: (err) => {
      res.write(
        `data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`,
      );
      res.end();
    },
    complete: () => {
      res.end();
    },
  });

  // 4. Handle premature client disconnects (e.g., closing browser tab or canceling request)
  res.on('close', () => {
    subscription.unsubscribe();
  });
}
}