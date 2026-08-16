import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { AuthenticatedUser } from '../auth/jwt.strategy';

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser;

    if (!user || !user.userId) {
      throw new ForbiddenException('User context missing');
    }

    // Extract organization ID from header or route parameters
    const organizationId =
      (request.headers['x-organization-id'] as string) ||
      request.params.organizationId;

    if (!organizationId) {
      throw new BadRequestException('Organization ID header (x-organization-id) or param is required');
    }

    // Verify membership
    const membership = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId: user.userId,
        },
      },
      include: {
        organization: true,
      },
    });

    if (!membership) {
      throw new ForbiddenException('Access denied: You are not a member of this organization');
    }

    // Attach validated tenant context to request
    request.tenant = {
      organizationId: membership.organizationId,
      role: membership.role,
      organization: membership.organization,
      membership,
    };

    return true;
  }
}