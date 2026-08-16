import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CreateAgentDto } from './dto/create-agent.dto';
import { UpdateAgentDto } from './dto/update-agent.dto';

@Injectable()
export class AgentsService {
  constructor(private readonly prisma: PrismaService) {}

  async createAgent(organizationId: string, dto: CreateAgentDto) {
    return this.prisma.agent.create({
      data: {
        organizationId,
        name: dto.name,
        description: dto.description,
        type: dto.type,
        systemPrompt: dto.systemPrompt,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async listAgentsByOrganization(organizationId: string) {
    return this.prisma.agent.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getAgentById(organizationId: string, agentId: string) {
    const agent = await this.prisma.agent.findFirst({
      where: {
        id: agentId,
        organizationId, // Strict tenant scoping
      },
    });

    if (!agent) {
      throw new NotFoundException(`Agent with ID ${agentId} not found in this organization`);
    }

    return agent;
  }

  async updateAgent(organizationId: string, agentId: string, dto: UpdateAgentDto) {
    // Verify existence within tenant first
    await this.getAgentById(organizationId, agentId);

    return this.prisma.agent.update({
      where: { id: agentId },
      data: dto,
    });
  }

  async deleteAgent(organizationId: string, agentId: string) {
    // Verify existence within tenant first
    await this.getAgentById(organizationId, agentId);

    return this.prisma.agent.delete({
      where: { id: agentId },
    });
  }
}