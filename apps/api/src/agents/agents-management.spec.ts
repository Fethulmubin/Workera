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
import { AgentsService } from "./agents.service";
import { AgentExecutionService } from "./agent-execution.service";
import { AgentSupervisorService } from "./agent-supervisor.service";
import { KnowledgeBaseService } from "../knowledge-base/knowledge-base.service";
import { KnowledgeBaseController } from "../knowledge-base/knowledge-base.controller";
import { CreateAgentDto } from "./dto/create-agent.dto";
import { UpdateAgentDto } from "./dto/update-agent.dto";

describe("Phase 4 — Agent Management & Configuration", () => {
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

  const orgA = "org-111";
  const orgB = "org-222";
  const agentIdA = "agent-aaa";
  const agentIdB = "agent-bbb";
  const kbIdA = "kb-aaa";
  const userIdA = "user-aaa";

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
        if (key === "GEMINI_MODEL") return "gemini-3.6-flash";
        if (key === "OPENROUTER_API_KEY") return "mock-openrouter-key";
        if (key === "OPENROUTER_ROUTER_MODEL") return "typesafe/jev-router";
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

    agentsService = new AgentsService(mockPrisma);
    executionService = new AgentExecutionService(
      mockPrisma,
      mockVectorStore,
      mockEmbeddingService,
      mockConfigService,
    );
    supervisorService = new AgentSupervisorService(
      mockPrisma,
      executionService,
      mockConfigService,
    );
    kbService = new KnowledgeBaseService(
      mockPrisma,
      mockCloudinary,
      mockEmbeddingService,
      mockVectorStore,
      mockQueue,
    );

    // Mock Google Generative AI in executionService
    (executionService as any).genAI = {
      getGenerativeModel: jest.fn().mockReturnValue({
        startChat: jest.fn().mockReturnValue({
          sendMessage: jest.fn().mockResolvedValue({
            response: {
              text: () => "LLM agent response",
            },
          }),
          sendMessageStream: jest.fn().mockResolvedValue({
            stream: (async function* () {
              yield { text: () => "Stream chunk" };
            })(),
          }),
        }),
      }),
    };
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

    it("ADMIN role can invoke mutation endpoints", () => {
      const adminContext = createMockContext(
        AgentsController.prototype.create,
        AgentsController,
        { role: OrganizationRole.ADMIN, organizationId: orgA },
      );
      expect(rolesGuard.canActivate(adminContext)).toBe(true);
    });

    it("OWNER role can invoke mutation endpoints", () => {
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
      expect(agents.some((a: any) => !a.isActive)).toBe(true);
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

      expect(mockPrisma.agent.findFirst).toHaveBeenCalledWith({
        where: { id: agentIdA, organizationId: orgA },
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

    it("updateAgent verifies tenant ownership and throws NotFoundException for cross-tenant agent", async () => {
      mockPrisma.agent.findFirst.mockResolvedValue(null);

      await expect(
        agentsService.updateAgent(orgB, agentIdA, { name: "New Name" }),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.agent.update).not.toHaveBeenCalled();
    });

    it("deleteAgent verifies tenant ownership and cascades deletion", async () => {
      mockPrisma.agent.findFirst.mockResolvedValue({
        id: agentIdA,
        organizationId: orgA,
        knowledgeBases: [],
      });
      mockPrisma.agent.delete.mockResolvedValue({ id: agentIdA });

      const result = await agentsService.deleteAgent(orgA, agentIdA);

      expect(mockPrisma.agent.findFirst).toHaveBeenCalledWith({
        where: { id: agentIdA, organizationId: orgA },
        include: expect.any(Object),
      });
      expect(mockPrisma.agent.delete).toHaveBeenCalledWith({
        where: { id: agentIdA },
      });
      expect(result.id).toBe(agentIdA);
    });

    it("createAgent forces organizationId from context and defaults type and isActive", async () => {
      mockPrisma.agent.create.mockResolvedValue({
        id: "new-agent",
        organizationId: orgA,
        name: "Finance Helper",
        type: AgentType.FINANCE,
        isActive: true,
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
        },
      });
    });
  });

  describe("2. Validate Agent Configuration (DTO Validation)", () => {
    it("accepts valid CreateAgentDto", async () => {
      const dto = new CreateAgentDto();
      dto.name = "Valid Agent Name";
      dto.description = "Useful description of the agent.";
      dto.type = AgentType.HR;
      dto.systemPrompt = "You are an HR agent.";
      dto.isActive = true;

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it("rejects CreateAgentDto when name is empty or missing", async () => {
      const dto = new CreateAgentDto();
      dto.name = "";

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === "name")).toBe(true);
    });

    it("rejects CreateAgentDto when name exceeds 100 characters", async () => {
      const dto = new CreateAgentDto();
      dto.name = "A".repeat(101);

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === "name")).toBe(true);
    });

    it("rejects CreateAgentDto when description exceeds 500 characters", async () => {
      const dto = new CreateAgentDto();
      dto.name = "Valid Agent";
      dto.description = "D".repeat(501);

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === "description")).toBe(true);
    });

    it("rejects CreateAgentDto with invalid AgentType enum", async () => {
      const dto = new CreateAgentDto();
      dto.name = "Valid Agent";
      (dto as any).type = "INVALID_TYPE";

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === "type")).toBe(true);
    });

    it("rejects CreateAgentDto when systemPrompt exceeds 10000 characters", async () => {
      const dto = new CreateAgentDto();
      dto.name = "Valid Agent";
      dto.systemPrompt = "P".repeat(10001);

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === "systemPrompt")).toBe(true);
    });

    it("accepts valid UpdateAgentDto with optional fields", async () => {
      const dto = new UpdateAgentDto();
      dto.name = "Updated Agent";
      dto.isActive = false;

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });
  });

  describe("3. Verify System Prompt Usage", () => {
    it("uses configured systemPrompt in buildSystemPrompt and prepends it to prompt", () => {
      const customPrompt = "You are an expert financial consultant with strict confidentiality.";
      const chunks = [
        { documentTitle: "Q3 Report", content: "Revenue increased by 20%" },
      ];

      const prompt = executionService.buildSystemPrompt(customPrompt, chunks);

      expect(prompt).toContain(customPrompt);
      expect(prompt).toContain("[Source 1 - Q3 Report]");
      expect(prompt).toContain("Revenue increased by 20%");
      expect(prompt).toContain("Cite your sources");
    });

    it("falls back to default prompt when systemPrompt is null or empty", () => {
      const promptNull = executionService.buildSystemPrompt(null, []);
      expect(promptNull).toContain("You are a helpful AI assistant.");

      const promptEmpty = executionService.buildSystemPrompt("   ", []);
      expect(promptEmpty).toContain("You are a helpful AI assistant.");
    });

    it("executeChat sends the combined systemPrompt with custom prompt to LLM", async () => {
      const customPrompt = "You are a specialized Legal Auditor.";
      mockPrisma.agent.findFirst.mockResolvedValue({
        id: agentIdA,
        organizationId: orgA,
        name: "Legal Agent",
        systemPrompt: customPrompt,
        isActive: true,
        knowledgeBases: [],
      });

      mockPrisma.conversation.create.mockResolvedValue({
        id: "conv-test-1",
        organizationId: orgA,
        agentId: agentIdA,
        userId: userIdA,
      });

      mockPrisma.message.create.mockResolvedValue({
        id: "msg-res-1",
        role: "assistant",
        content: "Legal review response",
      });
      mockPrisma.message.findMany.mockResolvedValue([]);

      const getModelMock = (executionService as any).genAI.getGenerativeModel;
      const startChatMock = getModelMock().startChat;

      await executionService.executeChat(
        orgA,
        agentIdA,
        "Audit this contract",
        undefined,
        userIdA,
      );

      const sendMessageMock = startChatMock().sendMessage;
      expect(sendMessageMock).toHaveBeenCalledWith(
        expect.stringContaining(customPrompt),
      );
      expect(sendMessageMock).toHaveBeenCalledWith(
        expect.stringContaining("User: Audit this contract"),
      );
    });
  });

  describe("4. Agent Active/Inactive Behavior", () => {
    it("throws BadRequestException when executing an inactive agent in executeChat", async () => {
      mockPrisma.agent.findFirst.mockResolvedValue({
        id: agentIdA,
        organizationId: orgA,
        name: "Retired Agent",
        isActive: false,
        knowledgeBases: [],
      });

      await expect(
        executionService.executeChat(
          orgA,
          agentIdA,
          "Hello there",
          undefined,
          userIdA,
        ),
      ).rejects.toThrow(
        new BadRequestException(
          "Agent is inactive and cannot execute conversations",
        ),
      );

      expect(mockPrisma.conversation.create).not.toHaveBeenCalled();
    });

    it("emits error event when executing an inactive agent in executeChatStream", async () => {
      mockPrisma.agent.findFirst.mockResolvedValue({
        id: agentIdA,
        organizationId: orgA,
        name: "Retired Agent",
        isActive: false,
        knowledgeBases: [],
      });

      const events: any[] = [];
      await new Promise<void>((resolve) => {
        executionService
          .executeChatStream(
            orgA,
            agentIdA,
            "Streaming hello",
            undefined,
            userIdA,
          )
          .subscribe({
            next: (e) => events.push(JSON.parse(e.data)),
            complete: () => resolve(),
          });
      });

      expect(events.length).toBe(1);
      expect(events[0].type).toBe("error");
      expect(events[0].error).toContain("Agent is inactive");
    });

    it("supervisor does not stick to an inactive agent on continuing conversation", async () => {
      const existingConv = {
        id: "conv-old",
        organizationId: orgA,
        agentId: agentIdA,
        userId: userIdA,
        agent: {
          id: agentIdA,
          name: "Old Inactive Agent",
          isActive: false, // Inactive!
        },
      };

      mockPrisma.conversation.findFirst.mockResolvedValue(existingConv);
      // Available active agents in org:
      mockPrisma.agent.findMany.mockResolvedValue([
        {
          id: "agent-active-new",
          name: "New Active Agent",
          type: AgentType.GENERAL,
          description: "Ready to assist",
        },
      ]);

      const routing = await supervisorService.routeRequest(
        orgA,
        "Next step in conversation",
        "conv-old",
        false,
        userIdA,
      );

      // Must NOT stick to the inactive agent; instead selects active agent
      expect(routing.selectedAgentId).toBe("agent-active-new");
      expect(routing.reason).toContain("Only one active agent");
    });
  });

  describe("5. Agent ↔ Knowledge Base Linking & Unlinking", () => {
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

      expect(mockPrisma.knowledgeBase.findFirst).toHaveBeenCalledWith({
        where: { id: kbIdA, organizationId: orgA },
      });
      expect(mockPrisma.agent.findFirst).toHaveBeenCalledWith({
        where: { id: agentIdA, organizationId: orgA },
      });
      expect(mockPrisma.agentKnowledgeBase.upsert).toHaveBeenCalledWith({
        where: {
          agentId_knowledgeBaseId: {
            agentId: agentIdA,
            knowledgeBaseId: kbIdA,
          },
        },
        create: {
          agentId: agentIdA,
          knowledgeBaseId: kbIdA,
        },
        update: {},
      });
      expect(result.agentId).toBe(agentIdA);
    });

    it("linkAgent blocks cross-tenant linking: throws 404 when agent is in another org", async () => {
      mockPrisma.knowledgeBase.findFirst.mockResolvedValue({
        id: kbIdA,
        organizationId: orgA,
      });
      // Agent is in orgB
      mockPrisma.agent.findFirst.mockResolvedValue(null);

      await expect(
        kbService.linkAgent(orgA, kbIdA, agentIdB),
      ).rejects.toThrow(
        new NotFoundException("Agent not found in this organization"),
      );
      expect(mockPrisma.agentKnowledgeBase.upsert).not.toHaveBeenCalled();
    });

    it("linkAgent blocks cross-tenant linking: throws 404 when KB is in another org", async () => {
      // KB is in orgB
      mockPrisma.knowledgeBase.findFirst.mockResolvedValue(null);

      await expect(
        kbService.linkAgent(orgA, kbIdA, agentIdA),
      ).rejects.toThrow(
        new NotFoundException(
          "Knowledge base not found in this organization",
        ),
      );
      expect(mockPrisma.agentKnowledgeBase.upsert).not.toHaveBeenCalled();
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

      expect(mockPrisma.agentKnowledgeBase.delete).toHaveBeenCalledWith({
        where: {
          agentId_knowledgeBaseId: {
            agentId: agentIdA,
            knowledgeBaseId: kbIdA,
          },
        },
      });
      expect(res.message).toContain("unlinked");
    });

    it("unlinkAgent throws NotFoundException if link does not exist", async () => {
      mockPrisma.knowledgeBase.findFirst.mockResolvedValue({
        id: kbIdA,
        organizationId: orgA,
      });
      mockPrisma.agent.findFirst.mockResolvedValue({
        id: agentIdA,
        organizationId: orgA,
      });
      mockPrisma.agentKnowledgeBase.findUnique.mockResolvedValue(null);

      await expect(
        kbService.unlinkAgent(orgA, kbIdA, agentIdA),
      ).rejects.toThrow(
        new NotFoundException(
          "Link between Agent and Knowledge Base not found",
        ),
      );
      expect(mockPrisma.agentKnowledgeBase.delete).not.toHaveBeenCalled();
    });
  });
});
