import { Organization, OrganizationMember, OrganizationRole } from '@ai-workforce/database';

export interface TenantContext {
  organizationId: string;
  role: OrganizationRole;
  organization: Organization;
  membership: OrganizationMember;
}