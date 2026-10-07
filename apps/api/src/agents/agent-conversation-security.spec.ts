/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
jest.mock('@nestjs/bullmq', () => ({
  InjectQueue: () => () => {},
}));
jest.mock('bullmq', () => ({
  Queue: class {},
}));

import {
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrganizationRole, AgentType } from '@ai-workforce/database';
import { RolesGuard } from '../auth/roles.guard';
import { ROLES_KEY } from '../auth/roles.decorator';
import { AgentsController } from './agents.controller';
import { KnowledgeBaseController } from '../knowledge-base/knowledge-base.controller';
import { AgentExecutionService } from './agent-execution.service';
import { AgentSupervisorService } from './agent-supervisor.service';
import { PrismaService } from '../database/prisma.service';
import { VectorStoreService } from '../rag/vector-store.service';
import { EmbeddingService } from '../rag/embedding.service';
import { ConfigService } from '@nestjs/config';

describe('RBAC and Conversation Security', () => {
  let reflector: Reflector;
  let rolesGuard: RolesGuard;

  beforeEach(() => {
    reflector = new Reflector();
    rolesGuard = new RolesGuard(reflector);
  });

  const createMockExecutionContext = (
    handler: Function,
    controllerClass: Function,
    tenantContext?: { role: OrganizationRole; organizationId: string },
  ): ExecutionContext => {
    return {
      getHandler: () => handler,
      getClass: () => controllerClass,
      switchToHttp: () => ({
        getRequest: () => ({
          tenant: tenantContext,
        }),
      }),
    } as unknown as ExecutionContext;
  };

  describe('PHASE 1 — RBAC Tests', () => {
    it('AgentsController should have RolesGuard in its UseGuards metadata', () => {
      const guards = Reflect.getMetadata('__guards__', AgentsController) || [];
      const hasRolesGuard = guards.some(
        (guard: any) => guard === RolesGuard || guard.name === 'RolesGuard',
      );
      expect(hasRolesGuard).toBe(true);
    });

    it('KnowledgeBaseController should have RolesGuard in its UseGuards metadata', () => {
      const guards =
        Reflect.getMetadata('__guards__', KnowledgeBaseController) || [];
      const hasRolesGuard = guards.some(
        (guard: any) => guard === RolesGuard || guard.name === 'RolesGuard',
      );
      expect(hasRolesGuard).toBe(true);
    });

    it('AgentsController mutation endpoints require OWNER or ADMIN', () => {
      const createRoles = reflector.get<OrganizationRole[]>(
        ROLES_KEY,
        AgentsController.prototype.create,
      );
      const updateRoles = reflector.get<OrganizationRole[]>(
        ROLES_KEY,
        AgentsController.prototype.update,
      );
      const removeRoles = reflector.get<OrganizationRole[]>(
        ROLES_KEY,
        AgentsController.prototype.remove,
      );

      expect(createRoles).toEqual([
        OrganizationRole.OWNER,
        OrganizationRole.ADMIN,
      ]);
      expect(updateRoles).toEqual([
        OrganizationRole.OWNER,
        OrganizationRole.ADMIN,
      ]);
      expect(removeRoles).toEqual([
        OrganizationRole.OWNER,
        OrganizationRole.ADMIN,
      ]);
    });

    it('KnowledgeBaseController mutation endpoints require OWNER or ADMIN', () => {
      const createRoles = reflector.get<OrganizationRole[]>(
        ROLES_KEY,
        KnowledgeBaseController.prototype.create,
      );
      const linkAgentRoles = reflector.get<OrganizationRole[]>(
        ROLES_KEY,
        KnowledgeBaseController.prototype.linkAgent,
      );
      const uploadRoles = reflector.get<OrganizationRole[]>(
        ROLES_KEY,
        KnowledgeBaseController.prototype.uploadDocument,
      );

      expect(createRoles).toEqual([
        OrganizationRole.OWNER,
        OrganizationRole.ADMIN,
      ]);
      expect(linkAgentRoles).toEqual([
        OrganizationRole.OWNER,
        OrganizationRole.ADMIN,
      ]);
      expect(uploadRoles).toEqual([
        OrganizationRole.OWNER,
        OrganizationRole.ADMIN,
      ]);
    });

    it('RolesGuard allows MEMBER on endpoints without role restrictions', () => {
      const ctx = createMockExecutionContext(
        AgentsController.prototype.list,
        AgentsController,
        { role: OrganizationRole.MEMBER, organizationId: 'org-1' },
      );
      expect(rolesGuard.canActivate(ctx)).toBe(true);
    });

    it('RolesGuard denies MEMBER on endpoints requiring OWNER/ADMIN', () => {
      const ctx = createMockExecutionContext(
        AgentsController.prototype.create,
        AgentsController,
        { role: OrganizationRole.MEMBER, organizationId: 'org-1' },
      );
      expect(() => rolesGuard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('RolesGuard allows ADMIN and OWNER on endpoints requiring OWNER/ADMIN', () => {
      const adminCtx = createMockExecutionContext(
        AgentsController.prototype.create,
        AgentsController,
        { role: OrganizationRole.ADMIN, organizationId: 'org-1' },
      );
      expect(rolesGuard.canActivate(adminCtx)).toBe(true);

      const ownerCtx = createMockExecutionContext(
        AgentsController.prototype.create,
        AgentsController,
        { role: OrganizationRole.OWNER, organizationId: 'org-1' },
      );
      expect(rolesGuard.canActivate(ownerCtx)).toBe(true);
    });

    it('RolesGuard throws ForbiddenException if tenant context is missing on a protected route', () => {
      const ctx = createMockExecutionContext(
        AgentsController.prototype.create,
        AgentsController,
        undefined,
      );
      expect(() => rolesGuard.canActivate(ctx)).toThrow(ForbiddenException);
    });
  });

  describe('PHASE 2 — Conversation Security & Ownership Tests', () => {
    let mockPrisma: any;
    let mockVectorStore: any;
    let mockEmbeddingService: any;
    let mockConfigService: any;
    let executionService: AgentExecutionService;
    let supervisorService: AgentSupervisorService;

    const mockOrgId = 'org-100';
    const mockAgentId = 'agent-200';
    const mockUserId = 'user-300';
    const otherUserId = 'user-other';
    const otherOrgId = 'org-other';
    const otherAgentId = 'agent-other';
    const mockConvId = 'conv-valid-1';

    beforeEach(() => {
      mockPrisma = {
        agent: {
          findFirst: jest.fn(),
          findMany: jest.fn(),
          create: jest.fn(),
        },
        conversation: {
          findFirst: jest.fn(),
          create: jest.fn(),
        },
        message: {
          create: jest.fn(),
          findMany: jest.fn(),
        },
        organization: {
          findUnique: jest.fn(),
        },
      };

      mockVectorStore = {
        similaritySearch: jest.fn().mockResolvedValue([]),
      };

      mockEmbeddingService = {
        generateQueryEmbedding: jest.fn().mockResolvedValue([0.1, 0.2]),
      };

      mockConfigService = {
        get: jest.fn((key: string) => {
          if (key === 'GEMINI_API_KEY') return 'test-gemini-key';
          if (key === 'OPENROUTER_API_KEY') return 'test-openrouter-key';
          return null;
        }),
      };

      const mockAIService = {
        generateText: jest.fn().mockResolvedValue('Assistant response text'),
        streamText: jest.fn().mockReturnValue((async function* () {
          yield 'token1';
        })()),
        generateObject: jest.fn().mockResolvedValue({
          selectedAgentId: mockAgentId,
          confidence: 0.95,
          reason: 'Matched role',
        }),
        isConfigured: jest.fn().mockReturnValue(true),
      };

      executionService = new AgentExecutionService(
        mockPrisma as unknown as PrismaService,
        mockVectorStore as unknown as VectorStoreService,
        mockEmbeddingService as unknown as EmbeddingService,
        mockAIService as any,
      );

      supervisorService = new AgentSupervisorService(
        mockPrisma as unknown as PrismaService,
        executionService,
        mockAIService as any,
      );
    });

    describe('AgentExecutionService Ownership Enforcement', () => {
      it('creates new conversation with authenticated userId (never anonymous)', async () => {
        mockPrisma.agent.findFirst.mockResolvedValue({
          id: mockAgentId,
          organizationId: mockOrgId,
          knowledgeBases: [],
        });

        mockPrisma.conversation.create.mockResolvedValue({
          id: 'conv-new-1',
          organizationId: mockOrgId,
          agentId: mockAgentId,
          userId: mockUserId,
        });

        mockPrisma.message.create.mockResolvedValue({
          id: 'msg-1',
          content: 'Assistant response text',
        });
        mockPrisma.message.findMany.mockResolvedValue([]);

        const result = await executionService.executeChat(
          mockOrgId,
          mockAgentId,
          'Hello assistant',
          undefined,
          mockUserId,
        );

        expect(mockPrisma.conversation.create).toHaveBeenCalledWith({
          data: {
            organizationId: mockOrgId,
            agentId: mockAgentId,
            userId: mockUserId,
            title: 'Hello assistant',
          },
        });
        expect(result.conversationId).toBe('conv-new-1');
      });

      it('allows execution when conversation matches organization, agent, and user', async () => {
        mockPrisma.agent.findFirst.mockResolvedValue({
          id: mockAgentId,
          organizationId: mockOrgId,
          knowledgeBases: [],
        });

        mockPrisma.conversation.findFirst.mockResolvedValue({
          id: mockConvId,
          organizationId: mockOrgId,
          agentId: mockAgentId,
          userId: mockUserId,
        });

        mockPrisma.message.create.mockResolvedValue({
          id: 'msg-1',
          content: 'Assistant response text',
        });
        mockPrisma.message.findMany.mockResolvedValue([]);

        const result = await executionService.executeChat(
          mockOrgId,
          mockAgentId,
          'Continue conversation',
          mockConvId,
          mockUserId,
        );

        expect(mockPrisma.conversation.findFirst).toHaveBeenCalledWith({
          where: {
            id: mockConvId,
            organizationId: mockOrgId,
            agentId: mockAgentId,
            userId: mockUserId,
          },
        });
        expect(result.conversationId).toBe(mockConvId);
      });

      it('rejects cross-user access: throws NotFoundException when conversation belongs to another user', async () => {
        mockPrisma.agent.findFirst.mockResolvedValue({
          id: mockAgentId,
          organizationId: mockOrgId,
          knowledgeBases: [],
        });

        // Prisma findFirst returns null because userId does not match
        mockPrisma.conversation.findFirst.mockResolvedValue(null);

        await expect(
          executionService.executeChat(
            mockOrgId,
            mockAgentId,
            'Attempt hijack',
            mockConvId,
            otherUserId,
          ),
        ).rejects.toThrow(new NotFoundException('Conversation not found'));

        expect(mockPrisma.conversation.findFirst).toHaveBeenCalledWith({
          where: {
            id: mockConvId,
            organizationId: mockOrgId,
            agentId: mockAgentId,
            userId: otherUserId,
          },
        });
      });

      it('rejects cross-organization access: throws NotFoundException when conversation belongs to another org', async () => {
        mockPrisma.agent.findFirst.mockResolvedValue({
          id: mockAgentId,
          organizationId: otherOrgId,
          knowledgeBases: [],
        });

        mockPrisma.conversation.findFirst.mockResolvedValue(null);

        await expect(
          executionService.executeChat(
            otherOrgId,
            mockAgentId,
            'Attempt cross-org access',
            mockConvId,
            mockUserId,
          ),
        ).rejects.toThrow(new NotFoundException('Conversation not found'));
      });

      it('rejects agent mismatch: throws NotFoundException when conversation belongs to Agent A but requested for Agent B', async () => {
        mockPrisma.agent.findFirst.mockResolvedValue({
          id: otherAgentId,
          organizationId: mockOrgId,
          knowledgeBases: [],
        });

        mockPrisma.conversation.findFirst.mockResolvedValue(null);

        await expect(
          executionService.executeChat(
            mockOrgId,
            otherAgentId,
            'Attempt wrong agent execution',
            mockConvId,
            mockUserId,
          ),
        ).rejects.toThrow(new NotFoundException('Conversation not found'));

        expect(mockPrisma.conversation.findFirst).toHaveBeenCalledWith({
          where: {
            id: mockConvId,
            organizationId: mockOrgId,
            agentId: otherAgentId,
            userId: mockUserId,
          },
        });
      });

      it('executeChatStream enforces ownership and yields error event when conversation is invalid', (done) => {
        mockPrisma.agent.findFirst.mockResolvedValue({
          id: mockAgentId,
          organizationId: mockOrgId,
          knowledgeBases: [],
        });

        // Simulated cross-user failure
        mockPrisma.conversation.findFirst.mockResolvedValue(null);

        const stream$ = executionService.executeChatStream(
          mockOrgId,
          mockAgentId,
          'Streaming message',
          mockConvId,
          otherUserId,
        );

        stream$.subscribe({
          next: (event) => {
            const data = JSON.parse(event.data);
            expect(data.type).toBe('error');
            expect(data.error).toBe('Conversation not found');
            done();
          },
          error: (err) => {
            done(err);
          },
        });
      });
    });

    describe('AgentSupervisorService Rerouting and Conversation Isolation', () => {
      it('rejects supervisor chat if conversation does not belong to user', async () => {
        mockPrisma.conversation.findFirst.mockResolvedValue(null);

        await expect(
          supervisorService.executeSupervisedChat(
            mockOrgId,
            { message: 'Hello supervisor', conversationId: mockConvId },
            otherUserId,
          ),
        ).rejects.toThrow(new NotFoundException('Conversation not found'));
      });

      it('continues same conversation when supervisor routes to the same agent', async () => {
        const existingConv = {
          id: mockConvId,
          organizationId: mockOrgId,
          agentId: mockAgentId,
          userId: mockUserId,
          agent: { id: mockAgentId, name: 'Support Agent' },
        };

        mockPrisma.conversation.findFirst.mockResolvedValue(existingConv);
        mockPrisma.agent.findFirst.mockResolvedValue({
          id: mockAgentId,
          organizationId: mockOrgId,
          knowledgeBases: [],
        });
        mockPrisma.message.create.mockResolvedValue({ id: 'msg-1' });
        mockPrisma.message.findMany.mockResolvedValue([]);

        const result = await supervisorService.executeSupervisedChat(
          mockOrgId,
          { message: 'Continue query', conversationId: mockConvId },
          mockUserId,
        );

        expect(result.conversationId).toBe(mockConvId);
        expect(result.routing.selectedAgentId).toBe(mockAgentId);
      });

      it('starts a new conversation when supervisor reroutes to a different agent (agent mismatch protection)', async () => {
        const existingConv = {
          id: mockConvId,
          organizationId: mockOrgId,
          agentId: mockAgentId,
          userId: mockUserId,
          agent: { id: mockAgentId, name: 'Support Agent' },
        };

        // When finding existing conversation, return it
        mockPrisma.conversation.findFirst.mockImplementation(
          async ({ where }: any) => {
            if (
              where.id === mockConvId &&
              where.agentId &&
              where.agentId !== otherAgentId
            ) {
              return null;
            }
            return existingConv;
          },
        );

        // When forceReRoute is true, routeRequest will query available agents
        mockPrisma.agent.findMany.mockResolvedValue([
          {
            id: otherAgentId,
            name: 'Finance Agent',
            type: AgentType.GENERAL,
            description: 'Finance helper',
          },
        ]);

        mockPrisma.agent.findFirst.mockResolvedValue({
          id: otherAgentId,
          organizationId: mockOrgId,
          knowledgeBases: [],
        });

        mockPrisma.conversation.create.mockResolvedValue({
          id: 'conv-new-different-agent',
          organizationId: mockOrgId,
          agentId: otherAgentId,
          userId: mockUserId,
        });

        mockPrisma.message.create.mockResolvedValue({ id: 'msg-2' });
        mockPrisma.message.findMany.mockResolvedValue([]);

        const result = await supervisorService.executeSupervisedChat(
          mockOrgId,
          {
            message: 'I need expense reimbursement',
            conversationId: mockConvId,
            forceReRoute: true,
          },
          mockUserId,
        );

        // Resulting conversation should NOT be the old conversation belonging to Agent A
        expect(result.routing.selectedAgentId).toBe(otherAgentId);
        expect(result.conversationId).toBe('conv-new-different-agent');
        expect(mockPrisma.conversation.create).toHaveBeenCalledWith({
          data: {
            organizationId: mockOrgId,
            agentId: otherAgentId,
            userId: mockUserId,
            title: 'I need expense reimbursement',
          },
        });
      });
    });
  });
});
