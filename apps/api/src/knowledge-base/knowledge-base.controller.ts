import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { KnowledgeBaseService } from './knowledge-base.service';
import { CreateKnowledgeBaseDto } from './dto/create-knowledge-base.dto';
import { UpdateKnowledgeBaseDto } from './dto/update-knowledge-base.dto';
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

  @Get('search')
  async search(
    @CurrentTenant() tenant: TenantContext,
    @Query('q') query: string,
    @Query('agentId') agentId?: string,
  ) {
    return this.kbService.searchKnowledge(
      tenant.organizationId,
      query,
      agentId,
    );
  }

  @Get(':id')
  async getOne(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') kbId: string,
  ) {
    return this.kbService.getKnowledgeBaseById(tenant.organizationId, kbId);
  }

  @Patch(':id')
  @RequireRoles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  async update(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') kbId: string,
    @Body() dto: UpdateKnowledgeBaseDto,
  ) {
    return this.kbService.updateKnowledgeBase(tenant.organizationId, kbId, dto);
  }

  @Delete(':id')
  @RequireRoles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  async remove(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') kbId: string,
  ) {
    return this.kbService.deleteKnowledgeBase(tenant.organizationId, kbId);
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
    return this.kbService.uploadAndProcessDocument(
      tenant.organizationId,
      kbId,
      file,
      agentId,
    );
  }

  @Get(':id/documents')
  async listDocuments(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') kbId: string,
  ) {
    return this.kbService.listDocuments(tenant.organizationId, kbId);
  }

  @Get(':id/documents/:documentId/status')
  async getDocumentStatus(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') kbId: string,
    @Param('documentId') documentId: string,
  ) {
    return this.kbService.getDocumentStatus(
      tenant.organizationId,
      kbId,
      documentId,
    );
  }

  @Get(':id/documents/:documentId')
  async getDocument(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') kbId: string,
    @Param('documentId') documentId: string,
  ) {
    return this.kbService.getDocumentById(
      tenant.organizationId,
      kbId,
      documentId,
    );
  }

  @Delete(':id/documents/:documentId')
  @RequireRoles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  async deleteDocument(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') kbId: string,
    @Param('documentId') documentId: string,
  ) {
    return this.kbService.deleteDocument(
      tenant.organizationId,
      kbId,
      documentId,
    );
  }
}
