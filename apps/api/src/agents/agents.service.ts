import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { CreateAgentDto } from "./dto/create-agent.dto";
import { UpdateAgentDto } from "./dto/update-agent.dto";
import { AgentType } from "@ai-workforce/database";

@Injectable()
export class AgentsService {
  constructor(private readonly prisma: PrismaService) {}

  async createAgent(organizationId: string, dto: CreateAgentDto) {
    return this.prisma.agent.create({
      data: {
        organizationId,
        name: dto.name,
        description: dto.description,
        type: dto.type ?? AgentType.CUSTOM,
        systemPrompt: dto.systemPrompt,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async listAgentsByOrganization(organizationId: string) {
    return this.prisma.agent.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
    });
  }

  async getAgentById(organizationId: string, agentId: string) {
    const agent = await this.prisma.agent.findFirst({
      where: {
        id: agentId,
        organizationId, // Strict tenant scoping
      },
      include: {
        knowledgeBases: {
          select: {
            knowledgeBase: {
              select: {
                id: true,
                name: true,
                description: true,
                createdAt: true,
                updatedAt: true,
              },
            },
          },
        },
      },
    });

    if (!agent) {
      throw new NotFoundException(
        `Agent with ID ${agentId} not found in this organization`,
      );
    }

    const { knowledgeBases, ...agentData } = agent;

    return {
      ...agentData,
      knowledgeBases: knowledgeBases
        ? knowledgeBases.map((akb: any) => akb.knowledgeBase)
        : [],
    };
  }

  async updateAgent(
    organizationId: string,
    agentId: string,
    dto: UpdateAgentDto,
  ) {
    // Verify existence within tenant first
    await this.getAgentById(organizationId, agentId);

    return this.prisma.agent.update({
      where: { id: agentId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.systemPrompt !== undefined && {
          systemPrompt: dto.systemPrompt,
        }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
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
