import { NotFoundException } from '@nestjs/common';
import { ToolAccessLevel } from '@ai-workforce/database';
import { ToolAccessService } from './tool-access.service';
import { ToolRegistry } from './tool.registry';
import type { ToolDefinition } from './types/tool.types';

describe('ToolAccessService — Two-Level Tool Access Architecture', () => {
  let service: ToolAccessService;
  let registry: ToolRegistry;
  let mockPrisma: any;

  const sampleToolA: ToolDefinition = {
    name: 'date_time',
    description: 'Date and time tool',
    inputSchema: {} as any,
    execute: jest.fn(),
  };

  const sampleToolB: ToolDefinition = {
    name: 'custom_calculator',
    description: 'Custom calculator tool',
    inputSchema: {} as any,
    execute: jest.fn(),
  };

  beforeEach(() => {
    registry = new ToolRegistry();
    registry.register(sampleToolA);
    registry.register(sampleToolB);

    mockPrisma = {
      agent: {
        findFirst: jest.fn(),
      },
      agentTool: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        upsert: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };

    service = new ToolAccessService(mockPrisma, registry);
  });

  describe('isToolAccessible', () => {
    const orgId = 'org-1';
    const agentId = 'agent-1';

    it('returns false if tool is not registered in ToolRegistry', async () => {
      const accessible = await service.isToolAccessible(orgId, agentId, 'non_existent_tool');
      expect(accessible).toBe(false);
      expect(mockPrisma.agentTool.findFirst).not.toHaveBeenCalled();
    });

    it('returns true if tool is configured as GLOBAL and enabled in the organization', async () => {
      mockPrisma.agentTool.findFirst.mockResolvedValueOnce({
        id: 'at-1',
        organizationId: orgId,
        toolName: 'date_time',
        accessLevel: ToolAccessLevel.GLOBAL,
        isEnabled: true,
      });

      const accessible = await service.isToolAccessible(orgId, agentId, 'date_time');
      expect(accessible).toBe(true);
      expect(mockPrisma.agentTool.findFirst).toHaveBeenCalledWith({
        where: {
          organizationId: orgId,
          toolName: 'date_time',
          accessLevel: ToolAccessLevel.GLOBAL,
          isEnabled: true,
        },
      });
    });

    it('returns true if tool is explicitly ASSIGNABLE and enabled for the agent', async () => {
      // 1st call for GLOBAL returns null
      mockPrisma.agentTool.findFirst.mockResolvedValueOnce(null);
      // 2nd call for ASSIGNABLE agent-specific returns record
      mockPrisma.agentTool.findFirst.mockResolvedValueOnce({
        id: 'at-2',
        organizationId: orgId,
        agentId,
        toolName: 'custom_calculator',
        accessLevel: ToolAccessLevel.ASSIGNABLE,
        isEnabled: true,
      });

      const accessible = await service.isToolAccessible(orgId, agentId, 'custom_calculator');
      expect(accessible).toBe(true);
      expect(mockPrisma.agentTool.findFirst).toHaveBeenNthCalledWith(2, {
        where: {
          organizationId: orgId,
          agentId,
          toolName: 'custom_calculator',
          accessLevel: ToolAccessLevel.ASSIGNABLE,
          isEnabled: true,
        },
      });
    });

    it('returns false if tool is neither GLOBAL nor assigned to the agent', async () => {
      mockPrisma.agentTool.findFirst.mockResolvedValueOnce(null); // global check
      mockPrisma.agentTool.findFirst.mockResolvedValueOnce(null); // agent assignable check

      const accessible = await service.isToolAccessible(orgId, agentId, 'custom_calculator');
      expect(accessible).toBe(false);
    });

    it('returns false if tool is assigned to another agent in the same organization', async () => {
      mockPrisma.agentTool.findFirst.mockResolvedValueOnce(null); // global check
      mockPrisma.agentTool.findFirst.mockResolvedValueOnce(null); // agent assignable check for agent-1

      const accessible = await service.isToolAccessible(orgId, agentId, 'custom_calculator');
      expect(accessible).toBe(false);
    });

    it('maintains tenant isolation: returns false if tool is enabled in a different organization', async () => {
      const orgOther = 'org-other';
      mockPrisma.agentTool.findFirst.mockImplementation(async (args: any) => {
        if (args.where.organizationId === orgOther) {
          return { id: 'other', organizationId: orgOther, accessLevel: ToolAccessLevel.GLOBAL, isEnabled: true };
        }
        return null;
      });

      const accessible = await service.isToolAccessible(orgId, agentId, 'date_time');
      expect(accessible).toBe(false);
    });
  });

  describe('resolveToolsForAgent', () => {
    const orgId = 'org-1';
    const agentId = 'agent-1';

    it('throws NotFoundException if agent does not belong to the organization', async () => {
      mockPrisma.agent.findFirst.mockResolvedValue(null);

      await expect(
        service.resolveToolsForAgent(orgId, agentId),
      ).rejects.toThrow(NotFoundException);
    });

    it('resolves both GLOBAL tools and ASSIGNABLE tools assigned to this agent', async () => {
      mockPrisma.agent.findFirst.mockResolvedValue({ id: agentId, organizationId: orgId });
      mockPrisma.agentTool.findMany.mockResolvedValue([
        {
          id: 'at-1',
          organizationId: orgId,
          toolName: 'date_time',
          accessLevel: ToolAccessLevel.GLOBAL,
          isEnabled: true,
        },
        {
          id: 'at-2',
          organizationId: orgId,
          agentId,
          toolName: 'custom_calculator',
          accessLevel: ToolAccessLevel.ASSIGNABLE,
          isEnabled: true,
        },
      ]);

      const tools = await service.resolveToolsForAgent(orgId, agentId);
      expect(tools.map((t) => t.name)).toEqual(['date_time', 'custom_calculator']);
      expect(mockPrisma.agentTool.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: orgId,
          isEnabled: true,
          OR: [
            { accessLevel: ToolAccessLevel.GLOBAL },
            { agentId, accessLevel: ToolAccessLevel.ASSIGNABLE },
          ],
        },
      });
    });

    it('excludes assignable tools assigned to other agents', async () => {
      mockPrisma.agent.findFirst.mockResolvedValue({ id: agentId, organizationId: orgId });
      // Only GLOBAL tool returned for this query
      mockPrisma.agentTool.findMany.mockResolvedValue([
        {
          id: 'at-1',
          organizationId: orgId,
          toolName: 'date_time',
          accessLevel: ToolAccessLevel.GLOBAL,
          isEnabled: true,
        },
      ]);

      const tools = await service.resolveToolsForAgent(orgId, agentId);
      expect(tools.map((t) => t.name)).toEqual(['date_time']);
      expect(tools.find((t) => t.name === 'custom_calculator')).toBeUndefined();
    });

    it('filters out tools that are not in the ToolRegistry even if DB record exists', async () => {
      mockPrisma.agent.findFirst.mockResolvedValue({ id: agentId, organizationId: orgId });
      mockPrisma.agentTool.findMany.mockResolvedValue([
        {
          id: 'at-unknown',
          organizationId: orgId,
          toolName: 'unregistered_tool',
          accessLevel: ToolAccessLevel.GLOBAL,
          isEnabled: true,
        },
      ]);

      const tools = await service.resolveToolsForAgent(orgId, agentId);
      expect(tools).toHaveLength(0);
    });
  });

  describe('configureGlobalTool', () => {
    const orgId = 'org-1';

    it('throws NotFoundException if tool is not registered in ToolRegistry', async () => {
      await expect(
        service.configureGlobalTool(orgId, 'unregistered_tool'),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates or updates a global tool record for the organization', async () => {
      mockPrisma.agentTool.findFirst.mockResolvedValue(null);
      mockPrisma.agentTool.create.mockResolvedValue({
        id: 'at-new',
        organizationId: orgId,
        agentId: null,
        toolName: 'date_time',
        accessLevel: ToolAccessLevel.GLOBAL,
        isEnabled: true,
      });

      const res = await service.configureGlobalTool(orgId, 'date_time', true);
      expect(res.accessLevel).toBe(ToolAccessLevel.GLOBAL);
      expect(mockPrisma.agentTool.create).toHaveBeenCalledWith({
        data: {
          organizationId: orgId,
          agentId: null,
          toolName: 'date_time',
          accessLevel: ToolAccessLevel.GLOBAL,
          isEnabled: true,
        },
      });
    });
  });

  describe('assignToolToAgent & unassignToolFromAgent', () => {
    const orgId = 'org-1';
    const agentId = 'agent-1';

    it('throws NotFoundException when assigning an unregistered tool', async () => {
      await expect(
        service.assignToolToAgent(orgId, agentId, 'unregistered_tool'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when assigning to an agent from another org', async () => {
      mockPrisma.agent.findFirst.mockResolvedValue(null);

      await expect(
        service.assignToolToAgent(orgId, agentId, 'custom_calculator'),
      ).rejects.toThrow(NotFoundException);
    });

    it('upserts an assignable tool record for the agent', async () => {
      mockPrisma.agent.findFirst.mockResolvedValue({ id: agentId, organizationId: orgId });
      mockPrisma.agentTool.upsert.mockResolvedValue({
        id: 'at-assignable',
        organizationId: orgId,
        agentId,
        toolName: 'custom_calculator',
        accessLevel: ToolAccessLevel.ASSIGNABLE,
        isEnabled: true,
      });

      const res = await service.assignToolToAgent(orgId, agentId, 'custom_calculator', true);
      expect(res.accessLevel).toBe(ToolAccessLevel.ASSIGNABLE);
      expect(mockPrisma.agentTool.upsert).toHaveBeenCalledWith({
        where: {
          organizationId_agentId_toolName: {
            organizationId: orgId,
            agentId,
            toolName: 'custom_calculator',
          },
        },
        update: {
          accessLevel: ToolAccessLevel.ASSIGNABLE,
          isEnabled: true,
        },
        create: {
          organizationId: orgId,
          agentId,
          toolName: 'custom_calculator',
          accessLevel: ToolAccessLevel.ASSIGNABLE,
          isEnabled: true,
        },
      });
    });

    it('unassigns an assigned tool from an agent', async () => {
      mockPrisma.agentTool.findFirst.mockResolvedValue({
        id: 'at-assigned',
        organizationId: orgId,
        agentId,
        toolName: 'custom_calculator',
      });
      mockPrisma.agentTool.delete.mockResolvedValue({ id: 'at-assigned' });

      const res = await service.unassignToolFromAgent(orgId, agentId, 'custom_calculator');
      expect(mockPrisma.agentTool.delete).toHaveBeenCalledWith({
        where: { id: 'at-assigned' },
      });
      expect(res.id).toBe('at-assigned');
    });

    it('throws NotFoundException when unassigning a tool that is not assigned', async () => {
      mockPrisma.agentTool.findFirst.mockResolvedValue(null);

      await expect(
        service.unassignToolFromAgent(orgId, agentId, 'custom_calculator'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
