import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { AgentType, OrganizationRole } from '@ai-workforce/database';

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async createOrganization(userId: string, dto: CreateOrganizationDto) {
    const existingSlug = await this.prisma.organization.findUnique({
      where: { slug: dto.slug },
    });

    if (existingSlug) {
      throw new ConflictException('An organization with this slug already exists');
    }

return this.prisma.$transaction(async (tx) => {
  // 1. Create Organization
  const org = await tx.organization.create({
    data: {
      name: dto.name,
      slug: dto.slug,
    },
  });
  // 2. Set Creator as OWNER
  const member = await tx.organizationMember.create({
    data: {
      organizationId: org.id,
      userId,
      role: OrganizationRole.OWNER,
    },
  });
  // 3. Create Default General Agent for the Organization
  await tx.agent.create({
    data: {
      organizationId: org.id,
      name: `${dto.name} Assistant`,
      type: AgentType.GENERAL,
      description: 'Primary workplace assistant for general inquiries, drafting, productivity, and organization-wide support.',
      systemPrompt: `You are the primary General Workplace Assistant for ${dto.name}.
YOUR ROLE:
- Assist employees and team members with daily workplace productivity, drafting messages, answering questions, and general guidance.
- If a question pertains to a specific policy or financial record not yet in your knowledge base, provide helpful general advice and recommend consulting the relevant department.`,
      isActive: true,
    },
  });
  return {
    ...org,
    membership: member,
  };
});
  }

  async getUserOrganizations(userId: string) {
    const memberships = await this.prisma.organizationMember.findMany({
      where: { userId },
      include: {
        organization: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return memberships.map((m) => ({
      ...m.organization,
      role: m.role,
    }));
  }

  async getOrganizationById(organizationId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      include: {
        members: true,
        agents: true,
      },
    });

    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    return org;
  }
}