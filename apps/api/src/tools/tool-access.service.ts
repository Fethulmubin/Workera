import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { ToolRegistry } from './tool.registry';
import type { ToolDefinition } from './types/tool.types';
import { ToolAccessLevel } from '@ai-workforce/database';

export interface AssignToolDto {
  toolName: string;
}

@Injectable()
export class ToolAccessService {
  private readonly logger = new Logger(ToolAccessService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly toolRegistry: ToolRegistry,
  ) {}

  /**
   * Determine if a tool is accessible to an agent within an organization.
   * Access is granted if:
   * 1. The tool exists in the system registry.
   * 2. The tool is configured as GLOBAL (at organization level or system-wide configuration), OR
   * 3. The tool is explicitly assigned and enabled for the agent in that organization.
   */
  async isToolAccessible(
    organizationId: string,
    agentId: string,
    toolName: string,
  ): Promise<boolean> {
    if (!this.toolRegistry.has(toolName)) {
      return false;
    }

    // 1. Check if tool is GLOBAL within the organization
    const globalTool = await this.prisma.agentTool.findFirst({
      where: {
        organizationId,
        toolName,
        accessLevel: ToolAccessLevel.GLOBAL,
        isEnabled: true,
      },
    });

    if (globalTool) {
      return true;
    }

    // 2. Check if tool is explicitly assigned to this agent in this organization
    const agentAssignedTool = await this.prisma.agentTool.findFirst({
      where: {
        organizationId,
        agentId,
        toolName,
        accessLevel: ToolAccessLevel.ASSIGNABLE,
        isEnabled: true,
      },
    });

    return Boolean(agentAssignedTool);
  }

  /**
   * Resolve all active tool definitions accessible to a specific agent in an organization.
   * Resolves:
   * - All GLOBAL tools configured for the organization.
   * - All ASSIGNABLE tools enabled specifically for this agent.
   */
  async resolveToolsForAgent(
    organizationId: string,
    agentId: string,
  ): Promise<ToolDefinition[]> {
    // Verify agent belongs to the organization
    const agent = await this.prisma.agent.findFirst({
      where: {
        id: agentId,
        organizationId,
      },
    });

    if (!agent) {
      throw new NotFoundException('Agent not found in this organization');
    }

    // Query active tools for this org (either GLOBAL or assigned to this agent)
    const accessibleToolRecords = await this.prisma.agentTool.findMany({
      where: {
        organizationId,
        isEnabled: true,
        OR: [
          { accessLevel: ToolAccessLevel.GLOBAL },
          { agentId, accessLevel: ToolAccessLevel.ASSIGNABLE },
        ],
      },
    });

    const accessibleNames = new Set(
      accessibleToolRecords.map((record) => record.toolName),
    );

    return this.toolRegistry
      .list()
      .filter((tool) => accessibleNames.has(tool.name));
  }

  /**
   * Configure a tool as GLOBAL for an organization (accessible to all agents in that org).
   */
  async configureGlobalTool(
    organizationId: string,
    toolName: string,
    isEnabled = true,
  ) {
    if (!this.toolRegistry.has(toolName)) {
      throw new NotFoundException(`Tool "${toolName}" is not registered`);
    }

    const existing = await this.prisma.agentTool.findFirst({
      where: {
        organizationId,
        agentId: null,
        toolName,
      },
    });

    if (existing) {
      return this.prisma.agentTool.update({
        where: { id: existing.id },
        data: {
          accessLevel: ToolAccessLevel.GLOBAL,
          isEnabled,
        },
      });
    }

    return this.prisma.agentTool.create({
      data: {
        organizationId,
        agentId: null,
        toolName,
        accessLevel: ToolAccessLevel.GLOBAL,
        isEnabled,
      },
    });
  }

  /**
   * Assign an ASSIGNABLE tool to a specific agent within an organization.
   */
  async assignToolToAgent(
    organizationId: string,
    agentId: string,
    toolName: string,
    isEnabled = true,
  ) {
    if (!this.toolRegistry.has(toolName)) {
      throw new NotFoundException(`Tool "${toolName}" is not registered`);
    }

    const agent = await this.prisma.agent.findFirst({
      where: { id: agentId, organizationId },
    });

    if (!agent) {
      throw new NotFoundException('Agent not found in this organization');
    }

    return this.prisma.agentTool.upsert({
      where: {
        organizationId_agentId_toolName: {
          organizationId,
          agentId,
          toolName,
        },
      },
      update: {
        accessLevel: ToolAccessLevel.ASSIGNABLE,
        isEnabled,
      },
      create: {
        organizationId,
        agentId,
        toolName,
        accessLevel: ToolAccessLevel.ASSIGNABLE,
        isEnabled,
      },
    });
  }

  /**
   * Revoke/remove a tool assignment from an agent.
   */
  async unassignToolFromAgent(
    organizationId: string,
    agentId: string,
    toolName: string,
  ) {
    const existing = await this.prisma.agentTool.findFirst({
      where: {
        organizationId,
        agentId,
        toolName,
      },
    });

    if (!existing) {
      throw new NotFoundException(
        `Tool "${toolName}" is not assigned to this agent`,
      );
    }

    return this.prisma.agentTool.delete({
      where: { id: existing.id },
    });
  }
}
