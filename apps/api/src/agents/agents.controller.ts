import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AgentsService } from './agents.service';
import { CreateAgentDto } from './dto/create-agent.dto';
import { UpdateAgentDto } from './dto/update-agent.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenant/tenant.guard';
import { CurrentTenant } from '../tenant/current-tenant.decorator';
import type { TenantContext } from '../tenant/tenant.types';

@Controller('agents')
@UseGuards(JwtAuthGuard, TenantGuard)
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

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
}