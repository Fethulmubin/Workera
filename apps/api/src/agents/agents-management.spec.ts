/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
jest.mock("@nestjs/bullmq", () => ({
  InjectQueue: () => () => {},
}));
jest.mock("bullmq", () => ({
  Queue: class {},
}));

import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { validate } from "class-validator";
import { OrganizationRole, AgentType } from "@ai-workforce/database";
import { RolesGuard } from "../auth/roles.guard";
import { ROLES_KEY } from "../auth/roles.decorator";
import { AgentsController } from "./agents.controller";
import { PublicAgentsController } from "./public-agents.controller";
import { AgentsService } from "./agents.service";
import { AgentExecutionService } from "./agent-execution.service";
import { AgentSupervisorService } from "./agent-supervisor.service";
import { KnowledgeBaseService } from "../knowledge-base/knowledge-base.service";
import { KnowledgeBaseController } from "../knowledge-base/knowledge-base.controller";
import { CreateAgentDto } from "./dto/create-agent.dto";
import { UpdateAgentDto } from "./dto/update-agent.dto";
import { PublicChatDto } from "./dto/public-chat.dto";
import { PublicChatRateLimitGuard } from "./guards/public-chat-rate-limit.guard";

describe("Phase 4 — Agent Management, Configuration & Public Chat", () => {
  let reflector: Reflector;
  let rolesGuard: RolesGuard;

  let mockPrisma: any;
  let mockVectorStore: any;
  let mockEmbeddingService: any;
  let mockConfigService: any;
  let mockCloudinary: any;
  let mockQueue: any;

  let agentsService: AgentsService;
  let executionService: AgentExecutionService;
  let supervisorService: AgentSupervisorService;
  let kbService: KnowledgeBaseService;
  let publicController: PublicAgentsController;

  const orgA = "org-111";
  const orgB = "org-222";
  const agentIdA = "agent-aaa";
  const agentIdB = "agent-bbb";
  const kbIdA = "kb-aaa";
  const userIdA = "user-aaa";
  const anonSessionA = "session-1111-2222-3333";
  const anonSessionB = "session-9999-8888-7777";

  beforeEach(() => {
    reflector = new Reflector();
    rolesGuard = new RolesGuard(reflector);

    mockPrisma = {
      agent: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      knowledgeBase: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      agentKnowledgeBase: {
        upsert: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
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
      $queryRawUnsafe: jest.fn(),
      $executeRawUnsafe: jest.fn(),
    };

    mockVectorStore = {
      similaritySearch: jest.fn().mockResolvedValue([]),
    };

    mockEmbeddingService = {
      generateQueryEmbedding: jest.fn().mockResolvedValue(new Array(768).fill(0.1)),
      generateEmbeddings: jest.fn().mockResolvedValue([new Array(768).fill(0.1)]),
    };

    mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === "GEMINI_API_KEY") return "mock-gemini-key";
        if (key === "OPENROUTER_API_KEY") return "mock-openrouter-key";
        return "";
      }),
    };

    mockCloudinary = {
      uploadFile: jest.fn(),
      deleteFile: jest.fn().mockResolvedValue({ result: "ok" }),
    };

    mockQueue = {
      add: jest.fn(),
    };

    const mockAIService = {
      generateText: jest.fn().mockResolvedValue("AI agent response"),
      streamText: jest.fn().mockReturnValue((async function* () {
        yield "Stream chunk";
      })()),
      generateObject: jest.fn().mockResolvedValue({
        selectedAgentId: "agent-aaa",
        confidence: 0.9,
        reason: "Best match for prompt",
      }),
      isConfigured: jest.fn().mockReturnValue(true),
    };

    agentsService = new AgentsService(mockPrisma);
    executionService = new AgentExecutionService(
      mockPrisma,
      mockVectorStore,
      mockEmbeddingService,
      mockAIService as any,
      { list: () => [], has: () => false, get: () => undefined } as any,
    );
    supervisorService = new AgentSupervisorService(
      mockPrisma,
      executionService,
      mockAIService as any,
    );
    kbService = new KnowledgeBaseService(
      mockPrisma,
      mockCloudinary,
      mockEmbeddingService,
      mockVectorStore,
      mockQueue,
    );
    publicController = new PublicAgentsController(
      mockPrisma,
      executionService,
    );
  });

  const createMockContext = (
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

  describe("1. Harden Agent CRUD & RBAC", () => {
    it("AgentsController mutation endpoints require OWNER or ADMIN", () => {
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

    it("MEMBER role can access list and getOne (no restrictive role metadata)", () => {
      const listRoles = reflector.get<OrganizationRole[]>(
        ROLES_KEY,
        AgentsController.prototype.list,
      );
      const getOneRoles = reflector.get<OrganizationRole[]>(
        ROLES_KEY,
        AgentsController.prototype.getOne,
      );

      expect(listRoles).toBeUndefined();
      expect(getOneRoles).toBeUndefined();

      const memberContext = createMockContext(
        AgentsController.prototype.list,
        AgentsController,
        { role: OrganizationRole.MEMBER, organizationId: orgA },
      );
      expect(rolesGuard.canActivate(memberContext)).toBe(true);
    });

    it("MEMBER role cannot invoke mutation endpoints", () => {
      const memberContext = createMockContext(
        AgentsController.prototype.create,
        AgentsController,
        { role: OrganizationRole.MEMBER, organizationId: orgA },
      );
      expect(() => rolesGuard.canActivate(memberContext)).toThrow(
        ForbiddenException,
      );
    });

    it("ADMIN and OWNER roles can invoke mutation endpoints", () => {
      const adminContext = createMockContext(
        AgentsController.prototype.create,
        AgentsController,
        { role: OrganizationRole.ADMIN, organizationId: orgA },
      );
      expect(rolesGuard.canActivate(adminContext)).toBe(true);

      const ownerContext = createMockContext(
        AgentsController.prototype.remove,
        AgentsController,
        { role: OrganizationRole.OWNER, organizationId: orgA },
      );
      expect(rolesGuard.canActivate(ownerContext)).toBe(true);
    });

    it("listAgentsByOrganization includes both active and inactive agents scoped to organizationId", async () => {
      mockPrisma.agent.findMany.mockResolvedValue([
        { id: "agent-1", organizationId: orgA, name: "Active Agent", isActive: true },
        { id: "agent-2", organizationId: orgA, name: "Inactive Agent", isActive: false },
      ]);

      const agents = await agentsService.listAgentsByOrganization(orgA);

      expect(mockPrisma.agent.findMany).toHaveBeenCalledWith({
        where: { organizationId: orgA },
        orderBy: { createdAt: "desc" },
      });
      expect(agents.length).toBe(2);
    });

    it("getAgentById returns agent with linked knowledge bases cleanly flattened", async () => {
      mockPrisma.agent.findFirst.mockResolvedValue({
        id: agentIdA,
        organizationId: orgA,
        name: "Support Agent",
        type: AgentType.CUSTOM,
        knowledgeBases: [
          {
            knowledgeBase: {
              id: kbIdA,
              name: "Support Docs",
              description: "Company FAQs",
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          },
        ],
      });

      const result = await agentsService.getAgentById(orgA, agentIdA);

      expect(result.id).toBe(agentIdA);
      expect(result.knowledgeBases).toEqual([
        expect.objectContaining({
          id: kbIdA,
          name: "Support Docs",
        }),
      ]);
    });

    it("getAgentById throws NotFoundException when agent belongs to another organization", async () => {
      mockPrisma.agent.findFirst.mockResolvedValue(null);

      await expect(agentsService.getAgentById(orgB, agentIdA)).rejects.toThrow(
        new NotFoundException(
          `Agent with ID ${agentIdA} not found in this organization`,
        ),
      );
    });

    it("createAgent forces organizationId from context and defaults isPublic to false", async () => {
      mockPrisma.agent.create.mockResolvedValue({
        id: "new-agent",
        organizationId: orgA,
        name: "Finance Helper",
        type: AgentType.FINANCE,
        isActive: true,
        isPublic: false,
      });

      const dto: CreateAgentDto = {
        name: "Finance Helper",
        type: AgentType.FINANCE,
      };

      await agentsService.createAgent(orgA, dto);

      expect(mockPrisma.agent.create).toHaveBeenCalledWith({
        data: {
          organizationId: orgA,
          name: "Finance Helper",
          description: undefined,
          type: AgentType.FINANCE,
          systemPrompt: undefined,
          isActive: true,
          isPublic: false,
        },
      });
    });

    it("updateAgent allows updating isPublic by OWNER/ADMIN", async () => {
      mockPrisma.agent.findFirst.mockResolvedValue({
        id: agentIdA,
        organizationId: orgA,
      });
      mockPrisma.agent.update.mockResolvedValue({
        id: agentIdA,
        isPublic: true,
      });

      await agentsService.updateAgent(orgA, agentIdA, { isPublic: true });

      expect(mockPrisma.agent.update).toHaveBeenCalledWith({
        where: { id: agentIdA },
        data: {
          isPublic: true,
        },
      });
    });
  });

  describe("2. Validate Agent Configuration (DTO Validation)", () => {
    it("accepts valid CreateAgentDto with isPublic", async () => {
      const dto = new CreateAgentDto();
      dto.name = "Public Customer Agent";
      dto.description = "Assists general visitors.";
      dto.type = AgentType.CUSTOM;
      dto.isActive = true;
      dto.isPublic = true;

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it("rejects CreateAgentDto when name is empty or missing", async () => {
      const dto = new CreateAgentDto();
      dto.name = "";

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it("accepts valid PublicChatDto", async () => {
      const dto = new PublicChatDto();
      dto.message = "Hello, what are your hours?";
      dto.conversationId = "conv-123";

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it("rejects PublicChatDto when message is empty", async () => {
      const dto = new PublicChatDto();
      dto.message = "";

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe("3. System Prompt & Active/Inactive Lifecycle", () => {
    it("uses configured systemPrompt in buildSystemPrompt", () => {
      const customPrompt = "You are a friendly public representative.";
      const prompt = executionService.buildSystemPrompt(customPrompt, []);

      expect(prompt).toContain(customPrompt);
    });

    it("throws BadRequestException when executing inactive agent in executeChat", async () => {
      mockPrisma.agent.findFirst.mockResolvedValue({
        id: agentIdA,
        organizationId: orgA,
        isActive: false,
        isPublic: true,
      });

      await expect(
        executionService.executeChat(
          orgA,
          agentIdA,
          "Hello",
          undefined,
          userIdA,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("4. Public Agents Controller & Anonymous Sessions", () => {
    it("rejects anonymous chat if agent is private (isPublic: false)", async () => {
      mockPrisma.agent.findUnique.mockResolvedValue({
        id: agentIdA,
        organizationId: orgA,
        isActive: true,
        isPublic: false, // Private agent!
        organization: { id: orgA },
      });

      const req: any = { headers: {} };
      const res: any = { cookie: jest.fn(), setHeader: jest.fn() };
      const dto: PublicChatDto = { message: "Hello private agent" };

      await expect(
        publicController.chat(agentIdA, dto, req, res),
      ).rejects.toThrow(
        new NotFoundException("Agent not found or is not publicly accessible"),
      );

      expect(mockPrisma.conversation.create).not.toHaveBeenCalled();
    });

    it("rejects anonymous chat if public agent is inactive", async () => {
      mockPrisma.agent.findUnique.mockResolvedValue({
        id: agentIdA,
        organizationId: orgA,
        isActive: false, // Inactive!
        isPublic: true,
        organization: { id: orgA },
      });

      const req: any = { headers: {} };
      const res: any = { cookie: jest.fn(), setHeader: jest.fn() };
      const dto: PublicChatDto = { message: "Hello inactive public agent" };

      await expect(
        publicController.chat(agentIdA, dto, req, res),
      ).rejects.toThrow(
        new BadRequestException(
          "Agent is inactive and cannot execute conversations",
        ),
      );
    });

    it("allows anonymous chat with active public agent and creates session cookie", async () => {
      mockPrisma.agent.findUnique.mockResolvedValue({
        id: agentIdA,
        organizationId: orgA,
        isActive: true,
        isPublic: true,
        organization: { id: orgA },
      });

      mockPrisma.agent.findFirst.mockResolvedValue({
        id: agentIdA,
        organizationId: orgA,
        isActive: true,
        isPublic: true,
        knowledgeBases: [],
      });

      mockPrisma.conversation.create.mockResolvedValue({
        id: "conv-anon-1",
        organizationId: orgA,
        agentId: agentIdA,
        anonymousSessionId: expect.any(String),
      });

      mockPrisma.message.create.mockResolvedValue({
        id: "msg-anon-1",
        role: "assistant",
        content: "Public greeting response",
        createdAt: new Date(),
      });
      mockPrisma.message.findMany.mockResolvedValue([]);

      const req: any = { headers: {} };
      const res: any = { cookie: jest.fn(), setHeader: jest.fn() };
      const dto: PublicChatDto = { message: "What services do you offer?" };

      const response = await publicController.chat(agentIdA, dto, req, res);

      expect(response.conversationId).toBe("conv-anon-1");
      expect(response.message.content).toBe("Public greeting response");
      expect(response.anonymousSessionId).toBeDefined();

      // Verify HTTP-only cookie was set
      expect(res.cookie).toHaveBeenCalledWith(
        "workera_anon_session",
        response.anonymousSessionId,
        expect.objectContaining({ httpOnly: true, sameSite: "lax" }),
      );

      // Verify conversation record in DB has anonymousSessionId and null userId
      expect(mockPrisma.conversation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: orgA,
          agentId: agentIdA,
          anonymousSessionId: response.anonymousSessionId,
        }),
      });
    });

    it("reuses existing anonymous session from cookie or header", async () => {
      mockPrisma.agent.findUnique.mockResolvedValue({
        id: agentIdA,
        organizationId: orgA,
        isActive: true,
        isPublic: true,
        organization: { id: orgA },
      });

      mockPrisma.agent.findFirst.mockResolvedValue({
        id: agentIdA,
        organizationId: orgA,
        isActive: true,
        isPublic: true,
        knowledgeBases: [],
      });

      mockPrisma.conversation.create.mockResolvedValue({
        id: "conv-anon-existing",
        organizationId: orgA,
        agentId: agentIdA,
        anonymousSessionId: anonSessionA,
      });

      mockPrisma.message.create.mockResolvedValue({
        id: "msg-anon-2",
        role: "assistant",
        content: "Response",
        createdAt: new Date(),
      });
      mockPrisma.message.findMany.mockResolvedValue([]);

      const req: any = {
        headers: {
          "x-anonymous-session-id": anonSessionA,
        },
      };
      const res: any = { cookie: jest.fn(), setHeader: jest.fn() };
      const dto: PublicChatDto = { message: "Another question" };

      const response = await publicController.chat(agentIdA, dto, req, res);

      expect(response.anonymousSessionId).toBe(anonSessionA);
      expect(mockPrisma.conversation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          anonymousSessionId: anonSessionA,
        }),
      });
    });

    it("anonymous session CANNOT access or hijack another anonymous session conversation", async () => {
      mockPrisma.agent.findUnique.mockResolvedValue({
        id: agentIdA,
        organizationId: orgA,
        isActive: true,
        isPublic: true,
        organization: { id: orgA },
      });

      mockPrisma.agent.findFirst.mockResolvedValue({
        id: agentIdA,
        organizationId: orgA,
        isActive: true,
        isPublic: true,
        knowledgeBases: [],
      });

      // Conversation findFirst returns null because anonymousSessionId does not match
      mockPrisma.conversation.findFirst.mockResolvedValue(null);

      const req: any = {
        headers: {
          "x-anonymous-session-id": anonSessionB, // Session B attempts to access Session A conversation
        },
      };
      const res: any = { cookie: jest.fn(), setHeader: jest.fn() };
      const dto: PublicChatDto = {
        message: "Attempt hijack",
        conversationId: "conv-owned-by-session-a",
      };

      await expect(
        publicController.chat(agentIdA, dto, req, res),
      ).rejects.toThrow(new NotFoundException("Conversation not found"));

      expect(mockPrisma.conversation.findFirst).toHaveBeenCalledWith({
        where: {
          id: "conv-owned-by-session-a",
          organizationId: orgA,
          agentId: agentIdA,
          anonymousSessionId: anonSessionB,
        },
      });
    });

    it("anonymous session CANNOT access or hijack an authenticated user conversation", async () => {
      mockPrisma.agent.findUnique.mockResolvedValue({
        id: agentIdA,
        organizationId: orgA,
        isActive: true,
        isPublic: true,
        organization: { id: orgA },
      });

      mockPrisma.agent.findFirst.mockResolvedValue({
        id: agentIdA,
        organizationId: orgA,
        isActive: true,
        isPublic: true,
        knowledgeBases: [],
      });

      mockPrisma.conversation.findFirst.mockResolvedValue(null);

      const req: any = {
        headers: { "x-anonymous-session-id": anonSessionA },
      };
      const res: any = { cookie: jest.fn(), setHeader: jest.fn() };
      const dto: PublicChatDto = {
        message: "Attempt steal authenticated conv",
        conversationId: "conv-owned-by-user-123",
      };

      await expect(
        publicController.chat(agentIdA, dto, req, res),
      ).rejects.toThrow(new NotFoundException("Conversation not found"));
    });

    it("defense-in-depth: AgentExecutionService directly rejects anonymous session on private agent", async () => {
      mockPrisma.agent.findFirst.mockResolvedValue({
        id: agentIdA,
        organizationId: orgA,
        isActive: true,
        isPublic: false, // Private agent
        knowledgeBases: [],
      });

      await expect(
        executionService.executeChat(
          orgA,
          agentIdA,
          "Hello private agent directly",
          undefined,
          { anonymousSessionId: anonSessionA },
        ),
      ).rejects.toThrow(
        new ForbiddenException(
          "This agent is private and cannot be accessed anonymously",
        ),
      );
    });

    it("authenticated chat still executes properly with userId", async () => {
      mockPrisma.agent.findFirst.mockResolvedValue({
        id: agentIdA,
        organizationId: orgA,
        isActive: true,
        isPublic: false, // Even if private, authenticated member can execute
        knowledgeBases: [],
      });

      mockPrisma.conversation.create.mockResolvedValue({
        id: "conv-auth-1",
        organizationId: orgA,
        agentId: agentIdA,
        userId: userIdA,
      });

      mockPrisma.message.create.mockResolvedValue({
        id: "msg-auth-1",
        role: "assistant",
        content: "Auth response",
      });
      mockPrisma.message.findMany.mockResolvedValue([]);

      const result = await executionService.executeChat(
        orgA,
        agentIdA,
        "Auth message",
        undefined,
        userIdA,
      );

      expect(result.conversationId).toBe("conv-auth-1");
      expect(mockPrisma.conversation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: orgA,
          agentId: agentIdA,
          userId: userIdA,
        }),
      });
    });
  });

  describe("5. Rate Limiting on Public Chat", () => {
    it("PublicChatRateLimitGuard throttles excessive requests", () => {
      const guard = new PublicChatRateLimitGuard();
      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => ({
            ip: "192.168.1.100",
            headers: { "x-anonymous-session-id": "client-1" },
          }),
          getResponse: () => ({
            setHeader: jest.fn(),
          }),
        }),
      } as unknown as ExecutionContext;

      // First 30 requests should succeed
      for (let i = 0; i < 30; i++) {
        expect(guard.canActivate(mockContext)).toBe(true);
      }

      // 31st request should be throttled with HttpStatus.TOO_MANY_REQUESTS
      expect(() => guard.canActivate(mockContext)).toThrow(
        expect.objectContaining({
          status: 429,
        }),
      );
    });
  });

  describe("6. Agent ↔ Knowledge Base Linking & Unlinking", () => {
    it("linkAgent verifies both KB and Agent belong to the organization and avoids duplicates with upsert", async () => {
      mockPrisma.knowledgeBase.findFirst.mockResolvedValue({
        id: kbIdA,
        organizationId: orgA,
      });
      mockPrisma.agent.findFirst.mockResolvedValue({
        id: agentIdA,
        organizationId: orgA,
      });
      mockPrisma.agentKnowledgeBase.upsert.mockResolvedValue({
        agentId: agentIdA,
        knowledgeBaseId: kbIdA,
      });

      const result = await kbService.linkAgent(orgA, kbIdA, agentIdA);

      expect(mockPrisma.agentKnowledgeBase.upsert).toHaveBeenCalled();
      expect(result.agentId).toBe(agentIdA);
    });

    it("unlinkAgent requires OWNER or ADMIN role via RBAC metadata", () => {
      const unlinkRoles = reflector.get<OrganizationRole[]>(
        ROLES_KEY,
        KnowledgeBaseController.prototype.unlinkAgent,
      );

      expect(unlinkRoles).toEqual([
        OrganizationRole.OWNER,
        OrganizationRole.ADMIN,
      ]);
    });

    it("unlinkAgent unlinks agent and KB within same organization", async () => {
      mockPrisma.knowledgeBase.findFirst.mockResolvedValue({
        id: kbIdA,
        organizationId: orgA,
      });
      mockPrisma.agent.findFirst.mockResolvedValue({
        id: agentIdA,
        organizationId: orgA,
      });
      mockPrisma.agentKnowledgeBase.findUnique.mockResolvedValue({
        agentId: agentIdA,
        knowledgeBaseId: kbIdA,
      });
      mockPrisma.agentKnowledgeBase.delete.mockResolvedValue({
        agentId: agentIdA,
        knowledgeBaseId: kbIdA,
      });

      const res = await kbService.unlinkAgent(orgA, kbIdA, agentIdA);
      expect(res.message).toContain("unlinked");
    });
  });
});
