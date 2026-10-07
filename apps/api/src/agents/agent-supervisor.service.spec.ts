import { AgentSupervisorService } from './agent-supervisor.service';
import { PrismaService } from '../database/prisma.service';
import { AgentExecutionService } from './agent-execution.service';
import { AIService } from '../ai/ai.service';
import { AgentType } from '@ai-workforce/database';

describe('AgentSupervisorService', () => {
  let supervisorService: AgentSupervisorService;
  let mockPrisma: any;
  let mockExecutionService: any;
  let mockAIService: any;

  const mockOrgId = 'org-100';
  const mockUserId = 'user-100';
  const mockAgentA = {
    id: 'agent-tech',
    organizationId: mockOrgId,
    name: 'Tech Support',
    type: AgentType.CUSTOMER_SUPPORT,
    description: 'Handles technical and IT queries',
    isActive: true,
  };
  const mockAgentB = {
    id: 'agent-billing',
    organizationId: mockOrgId,
    name: 'Billing Support',
    type: AgentType.SALES,
    description: 'Handles invoices and refunds',
    isActive: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockPrisma = {
      organization: {
        findUnique: jest.fn().mockResolvedValue({ name: 'Acme Corp' }),
      },
      agent: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      conversation: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
    };

    mockExecutionService = {
      executeChat: jest.fn(),
      executeChatStream: jest.fn(),
    };

    mockAIService = {
      isConfigured: jest.fn().mockReturnValue(true),
      generateText: jest.fn(),
      streamText: jest.fn(),
      generateObject: jest.fn(),
    };

    supervisorService = new AgentSupervisorService(
      mockPrisma,
      mockExecutionService,
      mockAIService,
    );
  });

  describe('routeRequest', () => {
    it('returns single agent immediately without calling AI SDK when only one active agent exists', async () => {
      mockPrisma.agent.findMany.mockResolvedValue([mockAgentA]);

      const decision = await supervisorService.routeRequest(
        mockOrgId,
        'My internet is down',
      );

      expect(decision.selectedAgentId).toBe(mockAgentA.id);
      expect(decision.agentName).toBe(mockAgentA.name);
      expect(decision.confidence).toBe(1.0);
      expect(decision.reason).toContain('Only one active agent available');
      expect(mockAIService.generateObject).not.toHaveBeenCalled();
    });

    it('auto-provisions default general agent when no active agents exist in organization', async () => {
      mockPrisma.agent.findMany.mockResolvedValue([]);
      const defaultAgent = {
        id: 'agent-default',
        name: 'Acme Corp Assistant',
        type: AgentType.GENERAL,
        description: 'General assistant',
      };
      mockPrisma.agent.create.mockResolvedValue(defaultAgent);

      const decision = await supervisorService.routeRequest(
        mockOrgId,
        'Hello there',
      );

      expect(mockPrisma.agent.create).toHaveBeenCalled();
      expect(decision.selectedAgentId).toBe('agent-default');
      expect(decision.confidence).toBe(1.0);
    });

    it('routes prompt via AIService.generateObject structured output when multiple agents exist', async () => {
      mockPrisma.agent.findMany.mockResolvedValue([mockAgentA, mockAgentB]);
      mockAIService.generateObject.mockResolvedValue({
        selectedAgentId: mockAgentA.id,
        confidence: 0.95,
        reason: 'Technical issue matched IT specialist',
      });

      const decision = await supervisorService.routeRequest(
        mockOrgId,
        'VPN connection is failing',
      );

      expect(mockAIService.generateObject).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ role: 'system' }),
          expect.objectContaining({
            role: 'user',
            content: 'VPN connection is failing',
          }),
        ]),
        expect.objectContaining({
          schemaName: 'RoutingDecision',
          temperature: 0.1,
        }),
      );
      expect(decision.selectedAgentId).toBe(mockAgentA.id);
      expect(decision.agentName).toBe(mockAgentA.name);
      expect(decision.confidence).toBe(0.95);
      expect(decision.reason).toBe('Technical issue matched IT specialist');
    });

    it('falls back safely to GENERAL agent if AI returns an unknown agentId', async () => {
      mockPrisma.agent.findMany.mockResolvedValue([
        mockAgentA,
        { ...mockAgentB, type: AgentType.GENERAL },
      ]);
      mockAIService.generateObject.mockResolvedValue({
        selectedAgentId: 'non-existent-agent-id',
        confidence: 0.99,
        reason: 'Imaginary agent',
      });

      const decision = await supervisorService.routeRequest(
        mockOrgId,
        'Random prompt',
      );

      expect(decision.selectedAgentId).toBe(mockAgentB.id);
      expect(decision.reason).toBe(
        'Supervisor router suggested unknown agent ID.',
      );
      expect(decision.confidence).toBe(0.5);
    });

    it('falls back safely if AIService is not configured', async () => {
      mockAIService.isConfigured.mockReturnValue(false);
      mockPrisma.agent.findMany.mockResolvedValue([mockAgentA, mockAgentB]);

      const decision = await supervisorService.routeRequest(
        mockOrgId,
        'Any message',
      );

      expect(decision.selectedAgentId).toBe(mockAgentA.id);
      expect(decision.reason).toBe('AIService not configured.');
      expect(decision.confidence).toBe(0.5);
      expect(mockAIService.generateObject).not.toHaveBeenCalled();
    });

    it('falls back safely if AIService.generateObject throws an error', async () => {
      mockPrisma.agent.findMany.mockResolvedValue([mockAgentA, mockAgentB]);
      mockAIService.generateObject.mockRejectedValue(
        new Error('Rate limit exceeded on OpenRouter'),
      );

      const decision = await supervisorService.routeRequest(
        mockOrgId,
        'Any message',
      );

      expect(decision.selectedAgentId).toBe(mockAgentA.id);
      expect(decision.reason).toContain('Rate limit exceeded on OpenRouter');
      expect(decision.confidence).toBe(0.5);
    });
  });

  describe('executeSupervisedChat', () => {
    it('successfully routes and delegates to AgentExecutionService', async () => {
      mockPrisma.agent.findMany.mockResolvedValue([mockAgentA]);
      mockExecutionService.executeChat.mockResolvedValue({
        conversationId: 'conv-new-1',
        message: { id: 'msg-1', content: 'Support response' },
        citations: [],
      });

      const result = await supervisorService.executeSupervisedChat(
        mockOrgId,
        { message: 'Fix my laptop' },
        mockUserId,
      );

      expect(result.routing.selectedAgentId).toBe(mockAgentA.id);
      expect(result.conversationId).toBe('conv-new-1');
      expect(result.message.content).toBe('Support response');
      expect(mockExecutionService.executeChat).toHaveBeenCalledWith(
        mockOrgId,
        mockAgentA.id,
        'Fix my laptop',
        undefined,
        mockUserId,
      );
    });
  });
});
