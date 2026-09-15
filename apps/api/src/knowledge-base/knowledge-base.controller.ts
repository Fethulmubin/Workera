import { Controller, Post, Get, Body, Param, UseGuards } from '@nestjs/common';
import { KnowledgeBaseService } from './knowledge-base.service';
import { CreateKnowledgeBaseDto } from './dto/create-knowledge-base.dto';
import { LinkAgentDto } from './dto/link-agent.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenant/tenant.guard';
import { CurrentTenant } from '../tenant/current-tenant.decorator';
import type { TenantContext } from '../tenant/tenant.types';

@Controller('knowledge-bases')
@UseGuards(JwtAuthGuard, TenantGuard)
export class KnowledgeBaseController {
  constructor(private readonly kbService: KnowledgeBaseService) {}

  @Post()
  async create(
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: CreateKnowledgeBaseDto,
  ) {
    return this.kbService.createKnowledgeBase(tenant.organizationId, dto);
  }

  @Get()
  async list(@CurrentTenant() tenant: TenantContext) {
    return this.kbService.listKnowledgeBases(tenant.organizationId);
  }

  @Post(':id/link-agent')
  async linkAgent(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') kbId: string,
    @Body() dto: LinkAgentDto,
  ) {
    return this.kbService.linkAgent(tenant.organizationId, kbId, dto.agentId);
  }
}
