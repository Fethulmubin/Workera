import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { TenantGuard } from '../tenant/tenant.guard';
import { CurrentTenant } from '../tenant/current-tenant.decorator';
import {type  TenantContext } from '../tenant/tenant.types';

@Controller('organizations')
@UseGuards(JwtAuthGuard)
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateOrganizationDto,
  ) {
    return this.organizationsService.createOrganization(user.userId, dto);
  }

  @Get()
  async listUserOrganizations(@CurrentUser() user: AuthenticatedUser) {
    return this.organizationsService.getUserOrganizations(user.userId);
  }

  @Get(':organizationId')
  @UseGuards(TenantGuard)
  async getTenantDetails(
    @Param('organizationId') organizationId: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return {
      organization: tenant.organization,
      userRole: tenant.role,
    };
  }
}