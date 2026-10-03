import { SetMetadata } from '@nestjs/common';
import { OrganizationRole } from '@ai-workforce/database';

export const ROLES_KEY = 'roles';

export const RequireRoles = (...roles: OrganizationRole[]) =>
  SetMetadata(ROLES_KEY, roles);