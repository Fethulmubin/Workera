import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { KnowledgeBaseService } from './knowledge-base.service';
import { CreateKnowledgeBaseDto } from './dto/create-knowledge-base.dto';
import { LinkAgentDto } from './dto/link-agent.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenant/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { OrganizationRole } from '@ai-workforce/database';
import { CurrentTenant } from '../tenant/current-tenant.decorator';
import type { TenantContext } from '../tenant/tenant.types';

@Controller('knowledge-bases')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class KnowledgeBaseController {
  constructor(private readonly kbService: KnowledgeBaseService) {}

  @Post()
  @RequireRoles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
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
  @RequireRoles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  async linkAgent(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') kbId: string,
    @Body() dto: LinkAgentDto,
  ) {
    return this.kbService.linkAgent(tenant.organizationId, kbId, dto.agentId);
  }

  @Post(':id/upload')
  @RequireRoles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(FileInterceptor('file'))
  async uploadDocument(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') kbId: string,
    @UploadedFile() file: Express.Multer.File,
    @Query('agentId') queryAgentId?: string,
    @Body('agentId') bodyAgentId?: string,
  ) {
    const agentId = queryAgentId || bodyAgentId;
    return this.kbService.uploadAndProcessDocument(tenant.organizationId, kbId, file, agentId);
  }

  @Get('search')
  async search(
    @CurrentTenant() tenant: TenantContext,
    @Query('q') query: string,
    @Query('agentId') agentId?: string,
  ) {
    return this.kbService.searchKnowledge(tenant.organizationId, query, agentId);
  }
}