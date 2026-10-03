import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrganizationRole } from '@ai-workforce/database';
import { ROLES_KEY } from './roles.decorator';
import type { TenantContext } from '../tenant/tenant.types';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles =
      this.reflector.getAllAndOverride<OrganizationRole[]>(
        ROLES_KEY,
        [context.getHandler(), context.getClass()],
      );

    // If the endpoint doesn't specify roles,
    // allow the request to continue.
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();

    const tenant = request.tenant as TenantContext | undefined;

    if (!tenant) {
      throw new ForbiddenException('Tenant context missing');
    }

    if (!requiredRoles.includes(tenant.role)) {
      throw new ForbiddenException(
        `Access denied: role ${tenant.role} is not allowed`,
      );
    }

    return true;
  }
}