import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { TenantGuard } from '../tenant/tenant.guard';
import { CurrentTenant } from '../tenant/current-tenant.decorator';
import type { TenantContext } from '../tenant/tenant.types';
import { ConversationsService } from './conversations.service';
import type { UpdateConversationDto } from './dto/update-conversation.dto';

@Controller('conversations')
@UseGuards(JwtAuthGuard, TenantGuard)
export class ConversationsController {
  constructor(
    private readonly conversationsService: ConversationsService,
  ) {}

  @Get()
  async list(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser('userId') userId: string,
  ) {
    return this.conversationsService.list(
      tenant.organizationId,
      userId,
    );
  }

  @Get(':id')
  async findOne(
    @Param('id') conversationId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser('userId') userId: string,
  ) {
    return this.conversationsService.findOne(
      conversationId,
      tenant.organizationId,
      userId,
    );
  }

  @Get(':id/messages')
  async getMessages(
    @Param('id') conversationId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser('userId') userId: string,
  ) {
    return this.conversationsService.getMessages(
      conversationId,
      tenant.organizationId,
      userId,
    );
  }

  @Patch(':id')
  async update(
    @Param('id') conversationId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser('userId') userId: string,
    @Body() dto: UpdateConversationDto,
  ) {
    return this.conversationsService.update(
      conversationId,
      tenant.organizationId,
      userId,
      dto,
    );
  }

  @Delete(':id')
  async remove(
    @Param('id') conversationId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser('userId') userId: string,
  ) {
    return this.conversationsService.remove(
      conversationId,
      tenant.organizationId,
      userId,
    );
  }
}